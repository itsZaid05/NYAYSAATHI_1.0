import 'dart:io';

import '../generated/serverpod.dart';
import '../generated/protocol.dart';

import '../corpus/fixture_answers.dart';
import 'engine.dart';
import 'model.dart';

/// Which model, with which key, and what happens when there is neither.
///
/// The key is read from the environment first so that `export GEMINI_API_KEY=…`
/// is enough in development, then from Serverpod's password file
/// (`config/passwords.yaml`, which is git-ignored). It is never sent to the
/// client, and the client has no way to ask for it.
class EngineConfig {
  const EngineConfig._();

  static const defaultModel = 'gemini-2.5-flash';
  static const keyName = 'geminiApiKey';

  static String? apiKey(Session session) {
    final fromEnv = Platform.environment['GEMINI_API_KEY'];
    if (fromEnv != null && fromEnv.trim().isNotEmpty) return fromEnv.trim();
    final fromFile = session.serverpod.getPassword(keyName);
    if (fromFile == null || fromFile.trim().isEmpty || fromFile.trim().startsWith('<')) {
      return null;
    }
    return fromFile.trim();
  }

  static String get model {
    final fromEnv = Platform.environment['GEMINI_MODEL'];
    return (fromEnv == null || fromEnv.isEmpty) ? defaultModel : fromEnv;
  }

  /// Set `NYAY_OFFLINE=1` to run the whole product against hand-written samples:
  /// same validation, same retrieval, same storage, same UI — and a visible
  /// banner, so nobody mistakes it for the live model.
  static bool get offline => Platform.environment['NYAY_OFFLINE'] == '1';

  static AdviceEngine forSession(Session session) {
    final key = apiKey(session);
    if (key == null || offline) {
      session.log(
        key == null
            ? 'no $keyName configured — answering from hand-written fixtures'
            : 'NYAY_OFFLINE=1 — answering from hand-written fixtures',
        level: LogLevel.info,
      );
      return AdviceEngine(provider: FixtureModel(kFixtureAnswers));
    }
    return AdviceEngine(provider: GeminiProvider(apiKey: key, model: model));
  }
}

/// Model-call budget, per case.
///
/// There is no login in this build, so there is no user id to rate limit against
/// and a per-IP limiter would need a header the endpoint does not read. The case
/// reference is therefore the unit of both ownership and budget: one case can ask
/// the model a bounded number of times per hour, which is the cost that actually
/// matters here.
class Limits {
  const Limits._();

  static const perHour = 12;
  static final _hits = <int, List<DateTime>>{};

  static Future<void> check(Session session, int caseId) async {
    final now = DateTime.now().toUtc();
    final window = (_hits[caseId] ??= <DateTime>[])
      ..removeWhere((at) => now.difference(at) > const Duration(hours: 1));
    if (window.length >= perHour) {
      throw AdviceUnavailableException(
        reason: 'this case has asked the model $perHour times in the last hour',
        retryAfterSeconds: 60 * 60 - now.difference(window.first).inSeconds,
      );
    }
    window.add(now);
  }

  static void reset() => _hits.clear();
}

/// Hands the plan to Serverpod's future-call queue instead of holding the request
/// open: a grounded call can take tens of seconds, and the client is watching the
/// channel anyway.
Future<void> scheduleAdvice(Session session, int adviceId) async {
  await session.serverpod.futureCalls
      .callWithDelay(const Duration(seconds: 1), identifier: 'advice-$adviceId')
      .advice
      .buildAdvice(adviceId);
}
