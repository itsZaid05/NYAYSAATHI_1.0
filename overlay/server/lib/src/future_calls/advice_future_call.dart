import 'package:serverpod/serverpod.dart';

import '../generated/protocol.dart';
import '../services/config.dart';

/// Runs the plan off the request path.
///
/// A grounded model call can take tens of seconds. Serverpod's future calls keep
/// it out of the HTTP request, survive a restart, and are retried by the framework
/// if they throw — which is why [buildAdvice] is idempotent per row.
///
/// The session argument is supplied by Serverpod: the call site reads
/// `.advice.buildAdvice(adviceId)` and passes only the id.
class AdviceFutureCall extends FutureCall {
  Future<void> buildAdvice(Session session, int adviceId) async {
    await EngineConfig.forSession(session).buildAdvice(session, adviceId: adviceId);
  }

  /// Safety net for rows left `queued` by a crash or a deploy.
  Future<void> requeueStranded(Session session) async {
    final cutoff = DateTime.now().toUtc().subtract(const Duration(minutes: 3));
    final stranded = await Advice.db.find(
      session,
      where: (t) => t.status.equals(AdviceStatus.queued),
      orderBy: (t) => t.updatedAt.asc(),
      limit: 20,
    );
    for (final advice in stranded.where((a) => a.createdAt.isBefore(cutoff))) {
      session.log('re-arming stranded plan ${advice.id}');
      await scheduleAdvice(session, advice.id!);
    }
  }
}
