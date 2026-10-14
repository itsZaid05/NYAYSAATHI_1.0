/// A one-page case brief, written by the server.
///
/// Deliberately not a PDF package: the whole file is the eleven objects below,
/// and it is valid enough for a reader to print and hand to a lawyer. Offsets in
/// the xref table are computed from the bytes actually written, which is the part
/// a hand-rolled writer usually gets wrong — so the unit test parses them back.
import 'dart:convert';
import 'dart:typed_data';

class PdfBuilder {
  PdfBuilder({this.pageSize = const PdfSize(595, 842), this.margin = 54});

  final PdfSize pageSize;
  final double margin;

  static const _lineHeight = 13.6;
  static const _charsPerLine = 92;

  final List<String> _lines = [];

  void title(String text) {
    _emit(text, size: 17, leading: 8);
  }

  void heading(String text) {
    _emit(text, size: 11.5, leading: 6);
  }

  void body(String text) {
    _emit(text, size: 9.8, leading: 3);
  }

  void bullet(String text) {
    _emit('• $text', size: 9.8, leading: 1);
  }

  void gap([double size = 8]) {
    _lines.add('\n+$size');
  }

  void _emit(String text, {required double size, required double leading}) {
    final normalized = text.replaceAll('\n', ' ').trim();
    if (normalized.isEmpty) return;
    for (final chunk in _wrap(normalized)) {
      _lines.add('$size|$chunk');
    }
    if (leading > 0) _lines.add('\n+$leading');
  }

  static List<String> _wrap(String text) {
    final words = text.split(RegExp(r'\s+'));
    final out = <String>[];
    var line = StringBuffer();
    for (final word in words) {
      if (line.length + word.length + 1 > _charsPerLine) {
        out.add(line.toString());
        line = StringBuffer(word);
      } else {
        if (line.isNotEmpty) line.write(' ');
        line.write(word);
      }
    }
    if (line.isNotEmpty) out.add(line.toString());
    return out.isEmpty ? const [''] : out;
  }

  /// Renders and returns the finished PDF.
  ByteData build({required String header, required String footer}) {
    final content = StringBuffer()
      ..writeln('BT')
      ..writeln('/F1 14 Tf');

    var y = pageSize.height - margin - 18;
    // A one-page brief: anything longer is truncated with a visible note rather
    // than silently spilling onto page two, which is the honest behaviour for a
    // document that will be printed and handed to someone.
    var lines = List<String>.of(_lines);
    final maxLines = ((pageSize.height - 2 * margin - 40) / _lineHeight).floor();
    var clipped = false;
    if (lines.length > maxLines) {
      lines = lines.sublist(0, maxLines - 1);
      clipped = true;
    }

    content.writeln('1 0 0 1 ${_num(margin)} ${_num(pageSize.height - margin)} Tm');
    for (final line in lines) {
      if (line.startsWith('\n+')) {
        y -= double.parse(line.substring(2));
        continue;
      }
      final bar = line.indexOf('|');
      final size = bar < 0 ? 9.8 : double.parse(line.substring(0, bar));
      final text = bar < 0 ? line : line.substring(bar + 1);
      content
        ..writeln('/F1 ${_num(size)} Tf')
        ..writeln('1 0 0 1 ${_num(margin)} ${_num(y)} Tm')
        ..writeln('(${_escape(text)}) Tj');
      y -= _lineHeight;
      if (y < margin) break;
    }
    if (clipped) {
      content
        ..writeln('/F1 9 Tf')
        ..writeln('1 0 0 1 ${_num(margin)} ${_num(y)} Tm')
        ..writeln('(${_escape('(continued on screen — download the full plan from the app)')}) Tj');
    }
    content.writeln('ET');

    return _document(
      content: content.toString(),
      header: header,
      footer: footer,
      width: pageSize.width,
      height: pageSize.height,
    );
  }

  static ByteData _document({
    required String content,
    required String header,
    required String footer,
    required double width,
    required double height,
  }) {
    // Objects: 1 catalog, 2 pages, 3 page, 4 contents, 5 font, 6 header/footer text.
    final objects = <String>[
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${_num(width)} ${_num(height)}] '
          '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      '<< /Length ${latin1.encode(content).length} >>\nstream\n$content\nendstream',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      'BT /F1 8.5 Tf 1 0 0 1 ${_num(54)} ${_num(height - 34)} Tm (${_escape(header)}) Tj '
          '1 0 0 1 ${_num(54)} 40 Tm (${_escape(footer)}) Tj ET',
    ];

    final out = BytesBuilder(copy: false)
      ..add(latin1.encode('%PDF-1.4\n%NyaySaathi case brief\n'));
    final offsets = <int>[];
    for (var i = 0; i < objects.length; i++) {
      offsets.add(out.length);
      out
        ..add(latin1.encode('${i + 1} 0 obj\n'))
        ..add(latin1.encode(objects[i]))
        ..add(latin1.encode('\nendobj\n'));
    }
    final xrefAt = out.length;
    final size = objects.length + 1;
    final xref = StringBuffer('xref\n0 $size\n0000000000 65535 f \n');
    for (final offset in offsets) {
      xref.write('${offset.toString().padLeft(10, '0')} 00000 n \n');
    }
    xref
      ..write('trailer\n<< /Size $size /Root 1 0 R >>\n')
      ..write('startxref\n$xrefAt\n%%EOF\n');
    out.add(latin1.encode(xref.toString()));

    final bytes = out.toBytes();
    return ByteData.view(bytes.buffer, bytes.offsetInBytes, bytes.length);
  }

  static String _num(double value) =>
      value == value.roundToDouble() ? value.toInt().toString() : value.toStringAsFixed(2);

  /// PDF string literals need these four escaped; nothing else, because
  /// Helvetica + WinAnsi has no other syntax that can bite here.
  static String _escape(String text) {
    final buffer = StringBuffer();
    for (final unit in text.runes) {
      final char = String.fromCharCode(unit);
      if (char == '\\' || char == '(' || char == ')') {
        buffer.write('\\');
        buffer.write(char);
      } else if (unit == 0x0A || unit == 0x0D) {
        buffer.write(' ');
      } else if (unit > 0x7E || unit < 0x20) {
        buffer.write('?');
      } else {
        buffer.write(char);
      }
    }
    return buffer.toString();
  }
}

class PdfSize {
  const PdfSize(this.width, this.height);
  final double width;
  final double height;
}
