import 'dart:typed_data';

import 'package:serverpod/serverpod.dart';

import '../generated/protocol.dart';
import '../services/config.dart';
import '../services/engine.dart';

/// The plan: queue it, retry it, read it, watch it arrive, and hand back a PDF.
///
/// Nothing here holds the request open for the model. `queue` writes a row and
/// schedules a future call; the client watches the channel and then reads the
/// row. That is why a reload, a slow answer and a restart all behave the same.
class AdviceEndpoint extends Endpoint {
  /// Queues a plan for this case (or returns the row that is already running).
  Future<int> queue(Session session, String reference) async {
    final legalCase = await _byReference(session, reference);
    return EngineConfig.forSession(session).ensureQueued(
      session,
      caseId: legalCase.id!,
      force: false,
    );
  }

  /// Re-arms a failed or stale plan and runs it again.
  Future<int> retry(Session session, String reference) async {
    final legalCase = await _byReference(session, reference);
    return EngineConfig.forSession(session).ensureQueued(
      session,
      caseId: legalCase.id!,
      force: true,
    );
  }

  /// The stored plan, or null while it is being written.
  Future<Advice?> latest(Session session, String reference) async {
    final legalCase = await _byReference(session, reference);
    final rows = await Advice.db.find(
      session,
      where: (t) => t.caseId.equals(legalCase.id!),
      orderBy: (t) => t.updatedAt.desc(),
      limit: 1,
    );
    return rows.isEmpty ? null : rows.first;
  }

  /// Live stages, from `case_<reference>`.
  Stream<AdviceProgress> watch(Session session, String reference) async* {
    yield* session.messages
        .createStream<AdviceProgress>('${AdviceEngine.channelPrefix}$reference');
  }

  /// The last triage, so the plan screen can show what the case was sorted into.
  Future<LegalCase> caseFile(Session session, String reference) async =>
      _byReference(session, reference);

  /// Builds the brief on the server and stores the bytes with the plan, so the
  /// file a user prints is the file the screen is showing.
  Future<ByteData> exportPdf(Session session, String reference) async {
    final legalCase = await _byReference(session, reference);
    final engine = EngineConfig.forSession(session);
    final bytes = await engine.pdfBytesFor(session, legalCase.id!);
    final rows = await Advice.db.find(
      session,
      where: (t) => t.caseId.equals(legalCase.id!),
      orderBy: (t) => t.updatedAt.desc(),
      limit: 1,
    );
    if (rows.isNotEmpty) {
      await Advice.db.updateRow(
        session,
        rows.first
          ..pdfBytes = bytes
          ..updatedAt = DateTime.now().toUtc(),
      );
    }
    session.log('built a ${bytes.lengthInBytes} byte brief for $reference');
    return bytes;
  }

  /// The stored copy, so a reload does not rebuild the file.
  Future<ByteData?> cachedPdf(Session session, String reference) async {
    final legalCase = await _byReference(session, reference);
    final rows = await Advice.db.find(
      session,
      where: (t) => t.caseId.equals(legalCase.id!),
      orderBy: (t) => t.updatedAt.desc(),
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return rows.first.pdfBytes;
  }

  Future<LegalCase> _byReference(Session session, String reference) async {
    final row = await LegalCase.db.findFirstRow(
      session,
      where: (t) => t.reference.equals(reference.trim().toUpperCase()),
    );
    if (row == null) {
      throw AdviceUnavailableException(reason: 'no case file "$reference"');
    }
    return row;
  }
}
