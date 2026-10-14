import 'dart:math';

import 'package:serverpod/serverpod.dart';

import '../generated/protocol.dart';
import '../services/config.dart';
import '../services/engine.dart';

/// Starts a case file, takes the answers, and re-triages as they arrive.
///
/// Looked up by `reference`, not by id: there is no login in this build, so the
/// random reference is what keeps one person's case out of another's hands. Every
/// method here resolves a reference or refuses, and the numeric id is only ever
/// used inside the server and in relations.
class IntakeEndpoint extends Endpoint {
  static const _alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  static const _maxNarrative = 6000;
  static const _maxAnswer = 1200;

  /// Opens the file and returns the first triage, questions included.
  Future<TriageResult> open(Session session, String narrative) async {
    final text = narrative.trim();
    if (text.length < 40) {
      throw AdviceUnavailableException(
        reason: 'tell us what happened in a sentence or two (at least 40 characters)',
      );
    }

    final now = DateTime.now().toUtc();
    final narrative =
        text.length > _maxNarrative ? text.substring(0, _maxNarrative) : text;

    // `reference` is unique, so a collision is retried rather than shown.
    late LegalCase saved;
    for (var attempt = 0; attempt < 4; attempt++) {
      try {
        saved = await LegalCase.db.insertRow(
          session,
          LegalCase(
            reference: _reference(),
            narrative: narrative,
            createdAt: now,
            updatedAt: now,
          ),
        );
        break;
      } on Exception {
        if (attempt == 3) rethrow;
      }
    }

    await IntakeTurn.db.insertRow(
      session,
      IntakeTurn(
        caseId: saved.id!,
        role: 'user',
        content: row.narrative,
        questionId: 'narrative',
        createdAt: now,
      ),
    );

    final engine = EngineConfig.forSession(session);
    return engine.triage(session, caseId: saved.id!, narrative: row.narrative);
  }

  /// Replaces the description on an existing file and decides again, so editing
  /// what you wrote does not silently start a second case.
  Future<TriageResult> revise(Session session, String reference, String narrative) async {
    final legalCase = await _byReference(session, reference);
    final text = narrative.trim();
    if (text.length < 40) {
      throw AdviceUnavailableException(reason: 'a little more detail, please');
    }
    final now = DateTime.now().toUtc();
    final clipped = text.length > _maxNarrative ? text.substring(0, _maxNarrative) : text;

    await LegalCase.db.updateRow(
      session,
      legalCase
        ..narrative = clipped
        ..updatedAt = now,
    );
    await IntakeTurn.db.insertRow(
      session,
      IntakeTurn(
        caseId: legalCase.id!,
        role: 'user',
        content: 'Revised description: $clipped',
        questionId: 'narrative',
        createdAt: now,
      ),
    );

    final turns = await IntakeTurn.db.find(
      session,
      where: (t) => t.caseId.equals(legalCase.id!),
      orderBy: (t) => t.createdAt.asc(),
    );
    return EngineConfig.forSession(session).triage(
      session,
      caseId: legalCase.id!,
      reference: legalCase.reference,
      narrative: clipped,
      turns: turns.where((turn) => turn.questionId != 'narrative').toList(),
    );
  }

  /// Records one answer and decides again — which is why an answer can change the
  /// questions you are asked next.
  Future<TriageResult> answer(
    Session session,
    String reference,
    String questionId,
    String answer,
  ) async {
    final legalCase = await _byReference(session, reference);
    final now = DateTime.now().toUtc();
    final text = answer.trim();
    if (text.isEmpty) {
      throw AdviceUnavailableException(reason: 'the answer is empty');
    }

    await IntakeTurn.db.insertRow(
      session,
      IntakeTurn(
        caseId: legalCase.id!,
        role: 'user',
        content: text.length > _maxAnswer ? text.substring(0, _maxAnswer) : text,
        questionId: questionId,
        createdAt: now,
      ),
    );

    final turns = await IntakeTurn.db.find(
      session,
      where: (t) => t.caseId.equals(legalCase.id!),
      orderBy: (t) => t.createdAt.asc(),
    );

    final engine = EngineConfig.forSession(session);
    return engine.triage(
      session,
      caseId: legalCase.id!,
      reference: legalCase.reference,
      narrative: legalCase.narrative,
      turns: turns.where((t) => t.questionId != 'narrative').toList(),
    );
  }

  /// Where the user left off, so a reload resumes instead of restarting.
  Future<IntakeProgress> progress(Session session, String reference) async {
    final legalCase = await _byReference(session, reference);
    final turns = await IntakeTurn.db.find(
      session,
      where: (t) => t.caseId.equals(legalCase.id!),
      orderBy: (t) => t.createdAt.asc(),
    );
    return IntakeProgress(
      caseId: legalCase.id!,
      reference: legalCase.reference,
      stage: legalCase.stage,
      // The next question comes from the last triage, not from this read: the
      // row is the truth and the client re-asks after a reload.
      question: null,
      turns: turns.length,
      completion: legalCase.completeness,
    );
  }

  /// The transcript, oldest first — shown in the UI so the user can see exactly
  /// what the model was told (with their identifiers already removed).
  Future<List<IntakeTurn>> transcript(Session session, String reference) async {
    final legalCase = await _byReference(session, reference);
    return IntakeTurn.db.find(
      session,
      where: (t) => t.caseId.equals(legalCase.id!),
      orderBy: (t) => t.createdAt.asc(),
    );
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

  String _reference() {
    final random = Random.secure();
    final buffer = StringBuffer('NYAY-');
    for (var i = 0; i < 8; i++) {
      buffer.write(_alphabet[random.nextInt(_alphabet.length)]);
      if (i == 3) buffer.write('-');
    }
    return buffer.toString().toUpperCase();
  }
}
