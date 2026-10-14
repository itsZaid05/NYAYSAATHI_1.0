import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// The only interface the engine knows.
///
/// Two implementations exist: [GeminiProvider], which speaks to
/// `generativelanguage.googleapis.com`, and [FixtureModel], which answers from
/// hand-written sample JSON. The engine's validation, retrieval and storage run identically
/// for both, which is what makes the offline mode honest rather than a demo
/// facade.
abstract class ModelProvider {
  String get name;

  /// Sends [prompt] under [system] constrained to [schema] and returns the
  /// decoded object plus any search-grounding sources.
  Future<ModelJson> generate({
    required String system,
    required String prompt,
    required Map<String, Object?> schema,
  });
}

class ModelJson {
  const ModelJson(this.value, {this.citations = const [], this.queries = const [], this.degraded});

  final Map<String, Object?> value;
  final List<ModelCitation> citations;
  final List<String> queries;
  final String? degraded;

  bool get grounded => citations.isNotEmpty;
}

class ModelCitation {
  const ModelCitation({required this.uri, this.title, this.startIndex});
  final String uri;
  final String? title;
  final int? startIndex;
}

class ModelFailure implements Exception {
  const ModelFailure(this.message, {this.retryAfterSeconds});
  final String message;
  final int? retryAfterSeconds;

  @override
  String toString() => 'ModelFailure: $message';
}

/// Google AI Studio key, server side only.
class GeminiProvider implements ModelProvider {
  GeminiProvider({
    required this.apiKey,
    this.model = 'gemini-2.5-flash',
    this.useSearchGrounding = true,
    this.timeout = const Duration(seconds: 90),
    http.Client? client,
  }) : _client = client;

  final String apiKey;
  final String model;
  final bool useSearchGrounding;
  final Duration timeout;
  final http.Client? _client;

  @override
  String get name => model;

  @override
  Future<ModelJson> generate({
    required String system,
    required String prompt,
    required Map<String, Object?> schema,
  }) async {
    final body = <String, Object?>{
      'systemInstruction': {
        'parts': [
          {'text': system},
        ],
      },
      'contents': [
        {
          'role': 'user',
          'parts': [
            {'text': prompt},
          ],
        },
      ],
      'generationConfig': {
        'temperature': 0.2,
        'responseMimeType': 'application/json',
        'responseSchema': schema,
      },
      if (useSearchGrounding) 'tools': [
        {'google_search': <String, Object?>{}},
      ],
    };

    final uri = Uri.https(
      'generativelanguage.googleapis.com',
      '/v1beta/models/$model:generateContent',
    );

    http.Response response;
    try {
      response = await _post(uri, body)
          .timeout(timeout);
    } on TimeoutException {
      throw const ModelFailure('the model took too long to answer');
    } on http.ClientException {
      throw const ModelFailure('could not reach the model API');
    }

    String? degraded;
    // Search grounding and a strict responseSchema are a recent combination and
    // some model/key pairs reject it. Retrying without the tool keeps the answer
    // (schema-only) instead of failing the user's case, and says so out loud.
    if (response.statusCode == 400 && useSearchGrounding) {
      body.remove('tools');
      try {
        response = await _post(uri, body)
            .timeout(timeout);
        degraded = 'web search grounding was refused; answered from the statute index only';
      } on Object {
        // fall through to the original error below
      }
    }

    if (response.statusCode != 200) {
      throw ModelFailure(
        'the model API returned ${response.statusCode}; check server configuration and quota',
        retryAfterSeconds: response.statusCode == 429 ? 30 : null,
      );
    }

    Object? decoded;
    try {
      decoded = jsonDecode(utf8.decode(response.bodyBytes));
    } on FormatException {
      throw const ModelFailure('the model API returned malformed JSON');
    }
    if (decoded is! Map<String, Object?>) {
      throw const ModelFailure('the model API returned something unreadable');
    }
    return _parse(decoded, degraded: degraded);
  }

  ModelJson _parse(Map<String, Object?> json, {String? degraded}) {
    final candidates = json['candidates'];
    if (candidates is! List || candidates.isEmpty) {
      final blocked = json['promptFeedback'];
      throw ModelFailure(
        'no answer returned${blocked is Map ? ' (${blocked['blockReason']})' : ''}',
      );
    }
    final candidate = candidates.first;
    if (candidate is! Map<String, Object?>) {
      throw const ModelFailure('the model returned a malformed candidate');
    }
    final content = candidate['content'];
    final rawParts = content is Map<String, Object?> ? content['parts'] : null;
    final parts = rawParts is List ? rawParts : const [];
    final text = parts
        .whereType<Map<String, Object?>>()
        .where((p) => p['thought'] != true)
        .map((p) => p['text'])
        .whereType<String>()
        .join('\n')
        .trim();
    if (text.isEmpty) {
      throw const ModelFailure('the model answered with nothing readable');
    }

    final payload = _jsonFrom(text);
    if (payload == null) {
      throw const ModelFailure('the model did not return valid JSON');
    }

    final meta = candidate['groundingMetadata'] as Map<String, Object?>?;
    final chunks = (meta?['groundingChunks'] as List?) ?? const [];
    final citations = chunks.whereType<Map<String, Object?>>().map((c) {
      final web = c['web'] as Map<String, Object?>?;
      return ModelCitation(
        uri: '${web?['uri'] ?? ''}',
        title: web?['title'] as String?,
      );
    }).where((c) => c.uri.isNotEmpty).toList();
    final queries = (meta?['webSearchQueries'] as List?)?.whereType<String>().toList() ?? const [];

    return ModelJson(
      payload,
      citations: citations,
      queries: queries,
      degraded: degraded,
    );
  }

  static Map<String, Object?>? _jsonFrom(String text) {
    var body = text;
    final fence = RegExp(r'```(?:json)?\s*([\s\S]*?)\s*```').firstMatch(text);
    if (fence != null) body = fence.group(1)!.trim();
    final start = body.indexOf('{');
    final end = body.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      final decoded = jsonDecode(body.substring(start, end + 1));
      return decoded is Map<String, Object?> ? decoded : null;
    } on FormatException {
      return null;
    }
  }

  Future<http.Response> _post(Uri uri, Map<String, Object?> body) {
    final headers = {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    };
    // The top-level helper closes its client. An injected test client remains
    // owned by the caller. Keys stay out of request URLs and exception messages.
    return _client == null
        ? http.post(uri, headers: headers, body: jsonEncode(body))
        : _client.post(uri, headers: headers, body: jsonEncode(body));
  }

}

/// Answers from hand-written JSON samples, not live model recordings.
///
/// Matched on the system prompt, because that is the only stable difference
/// between the two calls the engine makes. An unknown prompt is a failure, not a
/// silent empty answer — a fixture that does not match should look broken.
class FixtureModel implements ModelProvider {
  FixtureModel(this.answers, {this.latency = Duration.zero});

  final Map<String, Map<String, Object?>> answers;
  final Duration latency;

  @override
  String get name => 'fixture';

  @override
  Future<ModelJson> generate({
    required String system,
    required String prompt,
    required Map<String, Object?> schema,
  }) async {
    if (latency > Duration.zero) await Future<void>.delayed(latency);
    String? matched;
    for (final candidate in answers.keys) {
      if (system.contains(candidate)) {
        matched = candidate;
        break;
      }
    }
    final answer = matched == null ? null : answers[matched];
    if (answer == null) {
      throw ModelFailure('no sample answer for this prompt (${system.hashCode})');
    }
    return ModelJson(answer, queries: const ['hand-written sample; no live model call']);
  }
}
