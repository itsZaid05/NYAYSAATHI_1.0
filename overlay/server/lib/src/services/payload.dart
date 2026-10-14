/// Every field the app reads out of a model answer goes through here.
///
/// A JSON answer from a model is unbounded text: it can be 40,000 characters
/// long, contain 500 list items, or name an enum value that does not exist. The
/// database column and the UI both have limits, so the limits are enforced at the
/// boundary. Text and lists are capped, numeric scores are clamped, and
/// malformed required values are rejected. Citation indexes are never clamped.
class Payload {
  Payload(this._json, {this.maxStrings = 1400});

  final Map<String, Object?> _json;
  final int maxStrings;

  bool get isEmpty => _json.isEmpty;

  Object? _raw(String key) => _json[key];

  String string(String key, {int? max, bool required = false, String? fallback}) {
    final value = _raw(key);
    if (value == null || (value is String && value.trim().isEmpty)) {
      if (required) throw FieldError(key, 'missing');
      return fallback ?? '';
    }
    if (value is! String) throw FieldError(key, 'expected text, got ${value.runtimeType}');
    final limit = max ?? maxStrings;
    final text = value.trim();
    return text.length <= limit ? text : '${text.substring(0, limit - 1)}…';
  }

  List<String> strings(
    String key, {
    int maxItems = 12,
    int? itemMax,
    bool required = false,
  }) {
    final value = _raw(key);
    if (value == null) {
      if (required) throw FieldError(key, 'missing');
      return const [];
    }
    if (value is! List) throw FieldError(key, 'expected a list');
    final items = value
        .whereType<Object?>()
        .map((e) => e is String ? e : (e?.toString() ?? ''))
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty)
        .take(maxItems)
        .map((s) {
          final limit = itemMax ?? maxStrings;
          return s.length <= limit ? s : '${s.substring(0, limit - 1)}…';
        })
        .toList();
    if (required && items.isEmpty) throw FieldError(key, 'empty');
    return items;
  }

  int integer(String key, {int? min, int? max, int fallback = 0, bool required = false}) {
    final value = _raw(key);
    if (value == null) {
      if (required) throw FieldError(key, 'missing');
      return fallback;
    }
    final parsed = value is int
        ? value
        : (value is num ? value.toInt() : int.tryParse('$value'.trim()));
    if (parsed == null) throw FieldError(key, 'not a whole number');
    return _clampInt(parsed, min, max);
  }

  /// A citation must address an actual retrieved row. Never turn an invented
  /// index into a valid one by clamping it to the nearest row.
  int? citationIndex(String key, int count) {
    final value = _raw(key);
    if (value is! int || value < 1 || value > count) return null;
    return value;
  }

  double real(String key, {double? min, double? max, double fallback = 0, bool required = false}) {
    final value = _raw(key);
    if (value == null) {
      if (required) throw FieldError(key, 'missing');
      return fallback;
    }
    final parsed = value is num ? value.toDouble() : double.tryParse('$value'.trim());
    if (parsed == null || !parsed.isFinite) throw FieldError(key, 'not a finite number');
    final low = min ?? double.negativeInfinity;
    final high = max ?? double.infinity;
    return parsed < low ? low : (parsed > high ? high : parsed);
  }

  bool boolean(String key, {bool fallback = false}) {
    final value = _raw(key);
    if (value == null) return fallback;
    if (value is bool) return value;
    final text = '$value'.trim().toLowerCase();
    if (text == 'true' || text == 'yes' || text == '1') return true;
    if (text == 'false' || text == 'no' || text == '0') return false;
    throw FieldError(key, 'not a yes/no');
  }

  /// Enum values are the one place a model answer can quietly become a lie, so
  /// an unknown value throws instead of falling back — unless a fallback is
  /// explicitly allowed for a non-critical field.
  T enumeration<T extends Enum>(
    String key,
    List<T> values, {
    T? fallback,
    bool required = true,
  }) {
    final value = _raw(key);
    if (value == null || '$value'.trim().isEmpty) {
      if (fallback != null) return fallback;
      if (required) throw FieldError(key, 'missing');
      return values.first;
    }
    final wanted = _normalize('$value');
    for (final candidate in values) {
      if (_normalize(candidate.name) == wanted) return candidate;
    }
    if (fallback != null) return fallback;
    throw FieldError(key, 'unknown value "$value"');
  }

  /// Nested objects and arrays of objects, decoded through the same rules.
  List<Map<String, Object?>> objects(String key, {int maxItems = 10, bool required = false}) {
    final value = _raw(key);
    if (value == null) {
      if (required) throw FieldError(key, 'missing');
      return const [];
    }
    if (value is! List) throw FieldError(key, 'expected a list');
    if (value.any((item) => item is! Map<String, Object?>)) {
      throw FieldError(key, 'expected objects');
    }
    final objects = value.cast<Map<String, Object?>>().take(maxItems).toList(growable: false);
    if (required && objects.isEmpty) throw FieldError(key, 'empty');
    return objects;
  }

  static String _normalize(String text) => text
      .trim()
      .toLowerCase()
      .replaceAll(RegExp(r'[\s\-]+'), '_')
      .replaceAll(RegExp(r'[^a-z0-9_]'), '');

  static int _clampInt(int value, int? min, int? max) {
    final low = min ?? 0;
    final high = max ?? value;
    if (value < low) return low;
    if (value > high) return high;
    return value;
  }
}

class FieldError implements Exception {
  const FieldError(this.field, this.problem);

  final String field;
  final String problem;

  @override
  String toString() => 'field "$field": $problem';
}
