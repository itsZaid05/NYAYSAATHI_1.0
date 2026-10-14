import 'src/generated/serverpod.dart';
import 'src/services/corpus_service.dart';

/// The starting point of the NyaySaathi server.
///
/// Two additions on top of the template: the statute corpus is seeded on first
/// boot, so a fresh clone needs no manual database step, and any plan left
/// `queued` by a crash is re-armed. Written against
/// `templates/serverpod_templates/projectname_server/lib/server.dart` at 4.0.3,
/// which is why `run` looks this minimal.
void run(List<String> args) async {
  final pod = Serverpod(args);

  await pod.start();

  await pod.withSession((session) async {
    if (await CorpusService.isEmpty(session)) {
      final added = await CorpusService.seed(session);
      session.log('seeded $added provisions into the statute index');
    }
    await session.serverpod.futureCalls
        .callWithDelay(const Duration(seconds: 20), identifier: 'advice-requeue')
        .advice
        .requeueStranded();
  });
}
