import 'dart:io';

import 'package:nyay_server/src/generated/protocol.dart';
import 'package:nyay_server/src/services/payload.dart';
import 'package:nyay_server/src/services/pdf.dart';
import 'package:nyay_server/src/services/redaction.dart';
import 'package:nyay_server/src/services/prompts.dart';
import 'package:nyay_server/src/services/risk.dart';
import 'package:test/test.dart';
import 'package:yaml/yaml.dart';

/// The guards are the product. Everything else here is plumbing around a model,
/// and a model can be wrong at any moment, so these tests pin the parts that
/// decide whether an answer is trusted at all. They need `serverpod generate`
/// (for [Urgency]) but no database, no key and no network.
void main() {
  group('payload hardening', () {
    test('clips text instead of trusting a length the model did not respect', () {
      final payload = Payload({'summary': 'x' * 4000}, maxStrings: 120);
      expect(payload.string('summary'), hasLength(120));
      expect(payload.string('summary'), endsWith('…'));
    });

    test('throws on a missing required field', () {
      expect(
        () => Payload({'urgency': 'urgent'}).string('summary', required: true),
        throwsA(isA<FieldError>()),
      );
    });

    test('matches enum names case- and separator-insensitively', () {
      expect(
        Payload({'urgency': ' AT RISK '}).enumeration(
          'urgency',
          Urgency.values,
          fallback: Urgency.soon,
        ),
        Urgency.soon,
      );
      expect(
        Payload({'urgency': 'URGENT'}).enumeration('urgency', Urgency.values),
        Urgency.urgent,
      );
    });

    test('refuses an invented enum value when no fallback is given', () {
      expect(
        () => Payload({'domain': 'defamation_of_character'})
            .enumeration('domain', LegalDomain.values),
        throwsA(isA<FieldError>()),
      );
    });

    test('never clamps an invalid citation to a real source', () {
      for (final value in [0, -1, 99, 1.5, '1', null]) {
        expect(Payload({'index': value}).citationIndex('index', 3), isNull);
      }
      expect(Payload({'index': 1}).citationIndex('index', 0), isNull);
      expect(Payload({'index': 2}).citationIndex('index', 3), 2);
    });

    test('rejects empty or malformed required object arrays', () {
      for (final value in [[], ['not an object']]) {
        expect(
          () => Payload({'steps': value}).objects('steps', required: true),
          throwsA(isA<FieldError>()),
        );
      }
    });

    test('rejects non-finite confidence values', () {
      expect(
        () => Payload({'confidence': double.nan}).real('confidence'),
        throwsA(isA<FieldError>()),
      );
    });

    test('caps lists and clamps numbers', () {
      final payload = Payload({
        'steps': List.generate(200, (i) => 'step $i'),
        'risk': 9999,
        'confidence': -3,
      });
      expect(payload.strings('steps', maxItems: 8), hasLength(8));
      expect(payload.integer('risk', min: 0, max: 100), 100);
      expect(payload.real('confidence', min: 0, max: 1), 0);
    });
  });

  group('redaction', () {
    test('removes the identifiers a legal narrative tends to contain', () {
      final result = redactPii(
        'Call me at 98765 43210 or zaid@example.com, my Aadhaar is '
        '1234 5678 9012 and my PAN is ABCDE1234F. Vehicle MH12AB1234.',
      );
      expect(result.text, isNot(contains('98765')));
      expect(result.text, isNot(contains('zaid@example.com')));
      expect(result.text, isNot(contains('1234 5678')));
      expect(result.replaced, contains('AADHAAR×1'));
      expect(result.text, isNot(contains('ABCDE1234F')));
      expect(result.replaced, containsAll(<String>['PHONE×1', 'EMAIL×1']));
      expect(result.didRedact, isTrue);
    });

    test('leaves the substance alone', () {
      final result = redactPii(
        'My landlord took two months of deposit in March 2023 and refuses to '
        'return it after I vacated in January.',
      );
      expect(result.text, contains('deposit in March 2023'));
      expect(result.replaced, isEmpty);
    });
  });

  group('risk', () {
    test('is arithmetic, so the same case always scores the same', () {
      int score() => assessRisk(
            urgency: Urgency.urgent,
            safetyEscalation: false,
            missingEvidenceCount: 3,
            hasDeadline: true,
            hasDocuments: false,
            domainConfidence: 0.4,
          ).score;
      expect(score(), score());
    });

    test('rises when somebody might get hurt', () {
      int withSafety(bool danger) => assessRisk(
            urgency: Urgency.soon,
            safetyEscalation: danger,
            missingEvidenceCount: 1,
            hasDeadline: false,
            hasDocuments: true,
            domainConfidence: 0.9,
          ).score;
      expect(withSafety(true), greaterThan(withSafety(false)));
    });

    test('names itself in words the user is shown', () {
      final result = assessRisk(
        urgency: Urgency.emergency,
        safetyEscalation: true,
        missingEvidenceCount: 4,
        hasDeadline: true,
        hasDocuments: false,
        domainConfidence: 0.2,
      );
      expect(result.score, 100);
      expect(result.escalate, isTrue);
      expect(result.factors, contains('Safety is at risk right now'));
      expect(result.label, 'Act now');
    });
  });

  group('schema and model agreement', () {
    /// The response schema handed to Gemini and the Serverpod model it is decoded
    /// into live in two different files, and nothing but this test stops them
    /// drifting apart — which would otherwise fail on a live answer at 21:50 on
    /// the day of the deadline.
    test('every triage schema key is declared by a model', () {
      expectSchemaAgainstModels(triageSchema, 'triage');
    });

    test('every advice schema key is declared by a model', () {
      expectSchemaAgainstModels(adviceSchema, 'advice');
    });
  });

  group('pdf', () {
    test('writes a document whose xref offsets point at real objects', () {
      final pdf = PdfBuilder()
        ..title('NyaySaathi test brief')
        ..body('One paragraph of body text that should wrap at the column edge '
            'and survive a second sentence intact.')
        ..heading('Next steps')
        ..bullet('Write to the committee');

      final bytes = pdf.build(header: 'H', footer: 'F');
      final text = String.fromCharCodes(bytes.buffer.asUint8List());

      expect(text, startsWith('%PDF-1.4'));
      expect(text.trimRight(), endsWith('%%EOF'));
      expect(text, contains('NyaySaathi test brief'));

      final start = int.parse(RegExp(r'startxref\n(\d+)').firstMatch(text)!.group(1)!);
      expect(text.substring(start, start + 4), 'xref');
      for (final match in RegExp(r'^(\d{10}) 00000 n', multiLine: true)
          .allMatches(text.substring(start))) {
        final offset = int.parse(match.group(1)!);
        expect(
          text.substring(offset, offset + 2),
          anyOf('1 ', '2 ', '3 ', '4 ', '5 ', '6 '),
          reason: 'xref entry at $offset should start an object',
        );
      }
    });

    test('escapes the characters that would otherwise end a string literal', () {
      final pdf = PdfBuilder()..body('a (paren), a \\backslash, and ) here');
      final text = String.fromCharCodes(
        pdf.build(header: 'x', footer: 'y').buffer.asUint8List(),
      );
      expect(text, contains(r'a \(paren\), a \\backslash, and \) here'));
    });
  });
}

void expectSchemaAgainstModels(Map<String, Object?> schema, String which) {
  final dir = Directory('lib/src/models');
  expect(dir.existsSync(), isTrue, reason: 'run this from the server package root');

  final declared = <String>{};
  for (final file in dir.listSync().whereType<File>().where((f) => f.path.endsWith('.spy.yaml'))) {
    final doc = loadYaml(file.readAsStringSync());
    if (doc is YamlMap && doc['fields'] is YamlMap) {
      for (final key in (doc['fields'] as YamlMap).keys) {
        declared.add('$key');
      }
    }
  }

  // Provider-only inputs drive policy or citation selection; they are not
  // stored fields and must not be added to a database model just to pass a test.
  final providerOnly = which == 'triage'
      ? {'keyFacts', 'domainConfidence', 'statuteUnclear'}
      : <String>{};
  final properties = (schema['properties'] as Map?) ?? const {};
  final missing = <String>[
    for (final key in properties.keys.cast<String>())
      if (!declared.contains(key) && !providerOnly.contains(key)) key,
  ];
  expect(missing, isEmpty,
      reason: '$which schema declares $missing but no model field does');
}
