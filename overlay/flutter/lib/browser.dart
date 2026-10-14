import 'dart:js_interop';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:web/web.dart' as web;

/// Everything this app does that only exists in a browser, in one file.
///
/// There is no login, so the case reference is kept in `localStorage`: it is the
/// only thing that can open the file again, which is also why it is a random
/// string rather than a number. No analytics, no cookies, no third-party script.
const _referenceKey = 'nyaysaathi:reference';

String? readStoredReference() {
  if (kIsWeb) return web.window.localStorage.getItem(_referenceKey);
  return null;
}

void storeReference(String reference) {
  if (kIsWeb) web.window.localStorage.setItem(_referenceKey, reference);
}

void forgetReference() {
  if (kIsWeb) web.window.localStorage.removeItem(_referenceKey);
}

/// Saves a server-built PDF without a plugin: a data URL and a synthetic click on
/// an anchor. This browser helper uses package:web and never
/// uploads anything the user has not already sent to the server.
Future<void> saveBytesAsFile(ByteData bytes, String fileName) async {
  if (!kIsWeb) {
    throw UnsupportedError('this build of the app only downloads on the web');
  }
  final dataUrl = Uri.dataFromBytes(
    bytes.buffer.asUint8List(bytes.offsetInBytes, bytes.lengthInBytes),
    mimeType: 'application/pdf',
  ).toString();
  final anchor = web.HTMLAnchorElement()
    ..href = dataUrl
    ..download = fileName
    ..style.display = 'none';
  web.document.body?.append(anchor);
  anchor.click();
  anchor.remove();
}

/// Copy-to-clipboard for a draft letter, so the text can leave the app without a
/// file ever being written to disk.
Future<void> copyText(String text) async {
  if (!kIsWeb) return;
  await web.window.navigator.clipboard.writeText(text).toDart;
}
