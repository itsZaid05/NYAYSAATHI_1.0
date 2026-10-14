/// Strips identifying details from anything sent to the model.
///
/// The app needs the *shape* of the facts, not the person's phone number. Each
/// replacement is a readable token, so the model still understands that a phone
/// number, an email or an Aadhaar was present — which matters, because "they
/// threatened to post my Aadhaar" is a different case from "they threatened me".
class Redacted {
  const Redacted(this.text, this.replaced);

  final String text;
  final List<String> replaced;

  bool get didRedact => replaced.isNotEmpty;
}

final _patterns = <_Rule>[
  _Rule('PHONE', RegExp(r'(?:(?:\+|00)91[\s-]?)?(?:\d[\s-]?){10}(?!\d)')),
  _Rule('EMAIL', RegExp(r'[\w.+-]+@[\w-]+\.[\w.-]{2,}')),
  _Rule('AADHAAR', RegExp(r'\b(?:\d{4}[ -]?){3}\d{4}\b')),
  _Rule('PAN', RegExp(r'\b[A-Z]{5}\d{4}[A-Z]\b')),
  _Rule('ACCOUNT', RegExp(r'\b(?:\d[ -]?){9,16}\b')),
  _Rule('DOB', RegExp(r'\b\d{1,2}[/-](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|[1-9]|1[0-2])[/-]\d{2,4}\b', caseSensitive: false)),
  _Rule('VEHICLE', RegExp(r'\b[A-Z]{2}\d{1,2}[A-Z]{1,2}\d{4}\b')),
  _Rule('NAME', RegExp(r'(?<=\bS[o0]\s|W/?o\s)[A-Z][a-z]+(?:\s[A-Z][a-z]+){0,3}')),
];

class _Rule {
  _Rule(this.token, this.pattern);
  final String token;
  final RegExp pattern;
}

Redacted redactPii(String input) {
  var text = input;
  final replaced = <String>[];
  for (final rule in _patterns) {
    if (!rule.pattern.hasMatch(text)) continue;
    final count = rule.pattern.allMatches(text).length;
    text = text.replaceAll(rule.pattern, '[${rule.token}]');
    replaced.add('${rule.token}×$count');
  }
  return Redacted(text.trim(), replaced);
}

/// Trims to a character budget on a word boundary, so nothing important is
/// chopped mid-sentence before the model sees it.
String clip(String text, int max) {
  final clean = text.trim();
  if (clean.length <= max) return clean;
  final cut = clean.substring(0, max);
  final at = cut.lastIndexOf(' ');
  return '${at > max * 0.6 ? cut.substring(0, at) : cut}…';
}
