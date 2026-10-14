import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nyay_server/src/services/model.dart';
import 'package:nyay_server/src/services/prompts.dart';
import 'package:test/test.dart';

http.Response answer() => http.Response(jsonEncode({
      'candidates': [
        {
          'content': {
            'parts': [
              {'thought': true, 'text': 'not part of the answer'},
              {'text': '{"summary":"sample"}'},
            ],
          },
        },
      ],
    }), 200);

void main() {
  test('provider sends the key in a header, never the URL', () async {
    final client = MockClient((request) async {
      expect(request.url.queryParameters, isNot(contains('key')));
      expect(request.headers['x-goog-api-key'], 'unit-test-key');
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      expect(body['generationConfig']['responseSchema'], triageSchema);
      return answer();
    });
    addTearDown(client.close);
    final provider = GeminiProvider(apiKey: 'unit-test-key', client: client);
    final result = await provider.generate(system: 'system', prompt: 'prompt', schema: triageSchema);
    expect(result.value['summary'], 'sample');
  });

  test('search rejection retries schema-only with a visible degradation note', () async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      if (calls == 1) {
        expect(body, contains('tools'));
        return http.Response('tool rejected', 400);
      }
      expect(body, isNot(contains('tools')));
      return answer();
    });
    addTearDown(client.close);
    final provider = GeminiProvider(apiKey: 'unit-test-key', client: client);
    final result = await provider.generate(system: 'system', prompt: 'prompt', schema: triageSchema);
    expect(calls, 2);
    expect(result.degraded, contains('statute index only'));
  });

  test('raw API error text is not exposed to the user', () async {
    final client = MockClient((_) async => http.Response(
      '{"error":{"message":"sensitive echoed request"}}', 429,
    ));
    addTearDown(client.close);
    final provider = GeminiProvider(apiKey: 'unit-test-key', client: client);
    await expectLater(
      provider.generate(system: 'system', prompt: 'prompt', schema: triageSchema),
      throwsA(isA<ModelFailure>()
          .having((e) => e.message, 'message', isNot(contains('sensitive')))
          .having((e) => e.retryAfterSeconds, 'retry', 30)),
    );
  });

  test('malformed successful responses produce a model failure', () async {
    final client = MockClient((_) async => http.Response('not JSON', 200));
    addTearDown(client.close);
    final provider = GeminiProvider(apiKey: 'unit-test-key', client: client);
    await expectLater(
      provider.generate(system: 'system', prompt: 'prompt', schema: triageSchema),
      throwsA(isA<ModelFailure>()),
    );
  });

  test('an unrelated fixture prompt fails rather than silently inventing an answer', () async {
    final provider = FixtureModel({'known prompt': {'summary': 'sample'}});
    await expectLater(
      provider.generate(system: 'unknown', prompt: 'prompt', schema: triageSchema),
      throwsA(isA<ModelFailure>()),
    );
  });
}
