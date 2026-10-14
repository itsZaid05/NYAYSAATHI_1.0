import 'dart:typed_data';

import 'package:serverpod/serverpod.dart';

import '../generated/protocol.dart';
import 'config.dart';
import 'corpus_service.dart';
import 'model.dart';
import 'payload.dart';
import 'pdf.dart';
import 'prompts.dart';
import 'redaction.dart';
import 'risk.dart';

/// The only thing in the app that talks to the model, and the only thing that
/// writes case rows — which is what keeps the two in sync.
///
/// Two passes, one retrieval each:
///
///   narrative + answers → [triage]      (retrieval across every domain)
///   triaged case        → [buildAdvice] (retrieval restricted to that domain)
///
/// Rows are updated by assigning fields and calling `updateRow` rather than
/// `copyWith`, because the generated `copyWith` reads a null argument as "keep
/// what is there" and this engine has to clear values (a stale error message when
/// a retry succeeds, the model name on a fixture run).
class AdviceEngine {
  AdviceEngine({required this.provider});

  static const channelPrefix = 'case_';
  static const maxNarrative = 6000;
  static const corpus = CorpusService();

  final ModelProvider provider;

  /// Documents mentioned in the narrative are the difference between "you say"
  /// and "you can show", which is worth a risk point — so it is a keyword check
  /// here rather than something the model has to remember to tell us.
  static final _documentHint = RegExp(
    r'\b(letter|email|message|receipt|invoice|agreement|contract|screenshot|'
    r'notice|record|acknowledgm|whatsapp| challan|challan|slip)\b',
    caseSensitive: false,
  );

  bool get isLive => provider.name != 'fixture';

  // ---------------------------------------------------------------- triage ---

  Future<TriageResult> triage(
    Session session, {
    required int caseId,
    required String reference,
    required String narrative,
    List<IntakeTurn> turns = const [],
  }) async {
    await Limits.check(session, caseId);

    final redacted = redactPii(narrative);
    final answers = [
      for (final turn in turns) '<${turn.role}> ${clip(redactPii(turn.content).text, 400)}',
    ].join('\n');
    final description = '${redacted.text}\n$answers';

    final probe = await corpus.retrieve(session: session, query: description);
    final context = await corpus.contextBlock(probe);

    final call = await provider.generate(
      system: kSystemPrompt,
      prompt: contextForTriage(
        narrative: clip(redacted.text, maxNarrative),
        answers: answers.isEmpty ? '(none yet)' : answers,
        corpus: context,
      ),
      schema: triageSchema,
    );

    final payload = Payload(call.value, maxStrings: 700);
    final domain = payload.enumeration('domain', LegalDomain.values, fallback: LegalDomain.other);
    final urgency = payload.enumeration('urgency', Urgency.values, fallback: Urgency.soon);
    final confidence = payload.real('domainConfidence', min: 0, max: 1);
    final safety = payload.boolean('safetyEscalation');
    final unclear = payload.boolean('statuteUnclear');
    final summary = payload.string('summary', max: 420, required: true);
    payload.strings('keyFacts', maxItems: 8, itemMax: 220, required: true);
    final missing = payload.strings('missingEvidence', maxItems: 6, itemMax: 220);
    final timeSensitivity = payload.string('timeSensitivity', max: 220);
    final questions = <IntakeQuestion>[];
    for (final raw in payload.objects('questions', maxItems: 3)) {
      final q = Payload(raw, maxStrings: 320);
      final prompt = q.string('prompt', max: 300, required: true);
      final why = q.string('why', max: 200);
      final id = q.string('id', max: 40);
      questions.add(
        IntakeQuestion(
          id: id.isEmpty ? 'q${questions.length + 1}' : id,
          prompt: prompt,
          why: why.isEmpty ? null : why,
        ),
      );
    }

    // Never re-ask something the person already answered: each pass returns a
    // fresh question list, and without this filter the same one comes back.
    final already = turns.map((turn) => turn.questionId).whereType<String>().toSet();
    questions.removeWhere((question) => already.contains(question.id));

    // A second, domain-restricted pass: the row records how many provisions the
    // app could actually stand on for the domain the model chose, and an empty
    // result is what makes the UI say "the law here is unclear".
    final grounded = await corpus.retrieve(
      session: session,
      query: description,
      domain: domain,
    );

    final risk = assessRisk(
      urgency: urgency,
      safetyEscalation: safety,
      missingEvidenceCount: missing.length,
      hasDeadline: timeSensitivity.isNotEmpty,
      hasDocuments: _documentHint.hasMatch(description),
      domainConfidence: confidence,
    );

    final completeness = (100 - missing.length * 12 - (unclear ? 15 : 0)).clamp(15, 100);

    final existing = await LegalCase.db.findById(session, caseId);
    if (existing == null) {
      throw AdviceUnavailableException(reason: 'case $caseId no longer exists');
    }
    final now = DateTime.now().toUtc();
    await LegalCase.db.updateRow(
      session,
      existing
        ..domain = domain
        ..urgency = urgency
        ..stage = CaseStage.triaged
        ..summary = summary
        ..riskScore = risk.score
        ..riskFactors = risk.factors
        ..missingEvidence = missing
        ..completeness = completeness
        ..timeSensitivity = timeSensitivity.isEmpty ? null : timeSensitivity
        ..safetyEscalation = risk.escalate
        ..promptVersion = kPromptVersion
        ..model = isLive ? provider.name : null
        ..updatedAt = now,
    );

    await _post(session, reference, AdviceStage.validating,
        'Sorted as ${domain.name}; ${grounded.length} provision(s) behind it.');

    return TriageResult(
      caseId: caseId,
      reference: existing.reference,
      domain: domain,
      urgency: urgency,
      summary: summary,
      riskScore: risk.score,
      riskFactors: risk.factors,
      missingEvidence: missing,
      completeness: completeness,
      timeSensitivity: timeSensitivity.isEmpty ? null : timeSensitivity,
      safetyEscalation: risk.escalate,
      questions: questions.isEmpty ? null : questions,
      promptVersion: kPromptVersion,
      model: isLive ? provider.name : null,
    );
  }

  // ----------------------------------------------------------------- plan ---

  /// Builds and stores the plan for a queued [Advice] row. Idempotent per row, so
  /// a retried future call cannot write a second copy of the same answer.
  Future<void> buildAdvice(
    Session session, {
    required int adviceId,
  }) async {
    final advice = await Advice.db.findById(session, adviceId);
    if (advice == null) return;
    if (advice.status == AdviceStatus.ready || advice.status == AdviceStatus.running) {
      return;
    }
    final legalCase = await LegalCase.db.findById(session, advice.caseId);
    if (legalCase == null || legalCase.id == null) {
      await _fail(session, advice, null, 'the case file was deleted');
      return;
    }
    final caseId = legalCase.id!;
    await Advice.db.updateRow(
      session,
      advice
        ..status = AdviceStatus.running
        ..errorMessage = null
        ..updatedAt = DateTime.now().toUtc(),
    );
    await _post(session, legalCase.reference, AdviceStage.retrieving,
        'Looking up the provision that actually applies…', adviceId: adviceId);

    try {
      final turns = await IntakeTurn.db.find(
        session,
        where: (t) => t.caseId.equals(caseId),
        orderBy: (t) => t.createdAt.asc(),
      );
      final description = [
        legalCase.narrative,
        for (final turn in turns.where((turn) => turn.questionId != 'narrative'))
          '<${turn.role}> ${clip(redactPii(turn.content).text, 400)}',
      ].join('\n');
      final sanitized = redactPii(description);
      final redacted = Redacted(clip(sanitized.text, maxNarrative), sanitized.replaced);

      final hits = await corpus.retrieve(
        session: session,
        query: redacted.text,
        domain: legalCase.domain,
      );
      final context = await corpus.contextBlock(hits);

      await _post(session, legalCase.reference, AdviceStage.writing,
          'Writing the steps, in order…', adviceId: adviceId);

      final call = await provider.generate(
        system: kAdviceSystemPrompt,
        prompt: contextForAdvice(
          triage: redactPii(
            '${_triageBlock(legalCase, redacted.replaced)}\n'
            'case description and answers: ${redacted.text}',
          ).text,
          corpus: context,
        ),
        schema: adviceSchema,
      );

      await _post(session, legalCase.reference, AdviceStage.validating,
          'Checking every citation against the statute index…', adviceId: adviceId);

      final plan = _plan(Payload(call.value), hits);

      await _post(session, legalCase.reference, AdviceStage.persisting,
          'Saving your case file.', adviceId: adviceId);

      await Advice.db.updateRow(
        session,
        advice
          ..status = AdviceStatus.ready
          ..headline = plan.headline
          ..whatYouCanDo = plan.whatYouCanDo
          ..steps = plan.steps
          ..authorities = plan.authorities
          ..drafts = plan.drafts
          ..expectations = plan.expectations
          ..referralNote = plan.referralNote
          ..model = isLive ? provider.name : null
          ..promptVersion = kPromptVersion
          ..groundingQueries = _grounding(call)
          ..errorMessage = null
          ..updatedAt = DateTime.now().toUtc(),
      );
      await LegalCase.db.updateRow(
        session,
        legalCase
          ..stage = CaseStage.advised
          ..updatedAt = DateTime.now().toUtc(),
      );

      await _post(session, legalCase.reference, AdviceStage.ready, 'Plan ready.',
          adviceId: adviceId);
    } on ModelFailure catch (e) {
      await _fail(session, advice, legalCase.reference, e.message);
      throw AdviceUnavailableException(
        reason: 'the model could not answer (${e.message})',
        retryAfterSeconds: e.retryAfterSeconds,
      );
    } on FieldError catch (e) {
      await _fail(session, advice, legalCase.reference, 'unusable answer: $e');
      throw AdviceUnavailableException(
        reason: 'the answer did not fit the shape this app needs ($e)',
      );
    } on Object catch (e) {
      await _fail(session, advice, legalCase.reference, '$e');
      throw AdviceUnavailableException(reason: 'could not finish the plan ($e)');
    }
  }

  /// Retry entry point used by the UI: re-arms a failed row and runs it again.
  Future<int> ensureQueued(
    Session session, {
    required int caseId,
    required bool force,
  }) async {
    final now = DateTime.now().toUtc();
    final legalCase = await LegalCase.db.findById(session, caseId);
    if (legalCase == null || legalCase.stage == CaseStage.intake) {
      throw AdviceUnavailableException(reason: 'complete triage before requesting a plan');
    }
    final existing = await Advice.db.find(
      session,
      where: (t) => t.caseId.equals(caseId),
      orderBy: (t) => t.updatedAt.desc(),
      limit: 1,
    );
    if (existing.isNotEmpty) {
      final row = existing.first;
      if (row.status == AdviceStatus.queued || row.status == AdviceStatus.running) {
        return row.id!;
      }
      if (!force && row.status == AdviceStatus.ready && legalCase.stage == CaseStage.advised) {
        return row.id!;
      }
      await Limits.check(session, caseId);
      await Advice.db.updateRow(
        session,
        row
          ..status = AdviceStatus.queued
          ..pdfBytes = null
          ..errorMessage = null
          ..updatedAt = now,
      );
      await scheduleAdvice(session, row.id!);
      return row.id!;
    }
    await Limits.check(session, caseId);
    final created = await Advice.db.insertRow(
      session,
      Advice(
        caseId: caseId,
        status: AdviceStatus.queued,
        createdAt: now,
        updatedAt: now,
      ),
    );
    await scheduleAdvice(session, created.id!);
    return created.id!;
  }

  // ------------------------------------------------------------------ pdf ---

  /// Renders the stored plan as a one-page brief. Built from the rows, not from
  /// the model's raw output, so the paper matches the screen exactly.
  Future<ByteData> pdfBytesFor(Session session, int caseId) async {
    final legalCase = await LegalCase.db.findById(session, caseId);
    if (legalCase == null) {
      throw AdviceUnavailableException(reason: 'case $caseId no longer exists');
    }
    final adviceRows = await Advice.db.find(
      session,
      where: (t) => t.caseId.equals(caseId),
      orderBy: (t) => t.updatedAt.desc(),
      limit: 1,
    );
    final advice = adviceRows.isEmpty ? null : adviceRows.first;

    final pdf = PdfBuilder()
      ..title('NyaySaathi — case brief ${legalCase.reference}')
      ..body('Prepared ${_date(DateTime.now().toUtc())}. '
          'This is legal information, not legal advice. No outcome is promised.')
      ..gap();

    pdf.heading('What you described');
    pdf.body(clip(legalCase.narrative, 900));
    pdf.heading('Where it falls');
    pdf.body('${legalCase.domain.name} • ${legalCase.urgency.name} • '
        'risk ${legalCase.riskScore}/100'
        '${legalCase.timeSensitivity == null ? '' : ' • ${legalCase.timeSensitivity}'}');
    for (final factor in legalCase.riskFactors ?? const <String>[]) {
      pdf.bullet(factor);
    }
    if (legalCase.safetyEscalation) {
      pdf.heading('Safety first');
      pdf.body('If you are in danger now, call 112. For shelter and legal-aid '
          'referral call 181.');
    }

    final steps = advice?.steps;
    if (steps == null || steps.isEmpty) {
      pdf.heading('Next steps');
      pdf.body('No plan has been written for this case yet. Answer the intake '
          'questions in the app and the plan will appear here.');
    } else {
      pdf.heading('Next steps');
      for (var i = 0; i < steps.length; i++) {
        final step = steps[i];
        pdf.body('${i + 1}. ${step.title}'
            '${step.byWhen == null ? '' : ' — ${step.byWhen}'}');
        pdf.body('   ${step.detail}');
        if (step.where != null || step.who != null) {
          pdf.body('   ${[step.who, step.where].whereType<String>().join(' · ')}');
        }
        for (final doc in step.documents ?? const <String>[]) {
          pdf.bullet('take: $doc');
        }
      }
      final authorities = advice?.authorities;
      if (authorities != null && authorities.isNotEmpty) {
        pdf.heading('What each step rests on');
        for (final authority in authorities) {
          pdf.body('${authority.code} — ${authority.title}');
          pdf.body('   ${authority.verbatim ?? authority.gist}');
          pdf.body('   ${authority.sourceUrl}'
              '${authority.needsVerification ? '  (verify this wording)' : ''}');
        }
      }
      if (advice?.expectations != null) {
        pdf.heading('What happens next');
        pdf.body(advice!.expectations!);
      }
      if (advice?.referralNote != null) {
        pdf.heading('When to get a human');
        pdf.body(advice!.referralNote!);
      }
    }

    return pdf.build(
      header: 'NyaySaathi case brief • ${legalCase.reference}',
      footer: 'Generated ${_date(DateTime.now().toUtc())} by '
          '${advice?.model ?? 'hand-written fixtures'} • prompt ${advice?.promptVersion ?? kPromptVersion}',
    );
  }

  // ------------------------------------------------------------- internals ---

  _Plan _plan(Payload payload, List<RetrievedProvision> hits) {
    final headline = payload.string('headline', max: 160, required: true);
    final steps = <NextStep>[];
    for (final raw in payload.objects('steps', maxItems: 8, required: true)) {
      final step = Payload(raw, maxStrings: 500);
      final citedIndex = step.citationIndex('authorityIndex', hits.length);
      steps.add(
        NextStep(
          title: step.string('title', max: 140, required: true),
          detail: step.string('detail', max: 900, required: true),
          who: _opt(step.string('who', max: 120)),
          where: _opt(step.string('where', max: 160)),
          byWhen: _opt(step.string('byWhen', max: 120)),
          documents: step.strings('documents', maxItems: 6, itemMax: 120).isEmpty
              ? null
              : step.strings('documents', maxItems: 6, itemMax: 120),
          authorityIndex: citedIndex,
        ),
      );
    }

    return _Plan(
      headline: headline,
      whatYouCanDo: payload.strings('whatYouCanDo', maxItems: 5, itemMax: 400),
      steps: steps,
      authorities: _authorities(payload, hits),
      drafts: [
        for (final raw in payload.objects('drafts', maxItems: 2))
          DraftDocument(
            kind: Payload(raw).string('kind', max: 80, required: true),
            to: _opt(Payload(raw).string('to', max: 120)),
            body: Payload(raw, maxStrings: 2400).string('body', max: 2400, required: true),
          ),
      ],
      expectations: _opt(payload.string('expectations', max: 700)),
      referralNote: _opt(payload.string('referralNote', max: 500)),
    );
  }

  /// Rebuilt from the retrieved rows, never from the answer's own text: the model
  /// chooses which index to rely on, the app supplies the wording and the URL.
  List<Authority>? _authorities(
    Payload payload,
    List<RetrievedProvision> hits,
  ) {
    final cited = <int>{};
    for (final raw in payload.objects('authorities', maxItems: 12)) {
      final index = Payload(raw).citationIndex('index', hits.length);
      if (index != null) cited.add(index);
    }
    for (final step in payload.objects('steps', maxItems: 8)) {
      final index = Payload(step).citationIndex('authorityIndex', hits.length);
      if (index != null) cited.add(index);
    }
    if (cited.isEmpty) return null;

    final ordered = cited.toList()..sort();
    return [
      for (final index in ordered)
        () {
          final provision = hits[index - 1].provision;
          return Authority(
            code: provision.code,
            title: provision.title,
            gist: provision.gist,
            verbatim: provision.verbatim,
            sourceUrl: provision.sourceUrl,
            needsVerification: provision.needsVerification,
            source: 'statuteCorpus',
          );
        }(),
    ];
  }

  Future<void> _fail(
      Session session, Advice advice, String? reference, String reason) async {
    await Advice.db.updateRow(
      session,
      advice
        ..status = AdviceStatus.failed
        ..errorMessage = clip(reason, 500)
        ..updatedAt = DateTime.now().toUtc(),
    );
    if (reference != null) {
      await _post(session, reference, AdviceStage.failed,
          'Could not finish. Tap retry.', adviceId: advice.id);
    }
  }

  Future<void> _post(
    Session session,
    String reference,
    AdviceStage stage,
    String detail, {
    int? adviceId,
  }) async {
    try {
      await session.messages.postMessage(
        '$channelPrefix$reference',
        AdviceProgress(
          reference: reference,
          adviceId: adviceId,
          stage: stage,
          detail: clip(detail, 200),
          at: DateTime.now().toUtc(),
        ),
      );
    } on Object catch (e) {
      // Progress is a convenience; losing it must never lose the plan.
      session.log('could not publish progress on $channelPrefix$reference: $e',
          level: LogLevel.warning);
    }
  }

  static String _triageBlock(LegalCase legalCase, List<String> redacted) => [
        'reference: ${legalCase.reference}',
        'domain: ${legalCase.domain.name}',
        'urgency: ${legalCase.urgency.name}',
        'summary: ${legalCase.summary ?? '(none)'}',
        'risk: ${legalCase.riskScore}/100',
        'factors: ${legalCase.riskFactors?.join('; ') ?? 'none'}',
        'still needed: ${legalCase.missingEvidence?.join('; ') ?? 'nothing recorded'}',
        'deadline mentioned: ${legalCase.timeSensitivity ?? 'no'}',
        'safety escalation: ${legalCase.safetyEscalation}',
        if (redacted.isNotEmpty) 'identifiers removed from the text: ${redacted.join(', ')}',
      ].join('\n');

  static List<String>? _grounding(ModelJson call) {
    final out = <String>[
      ...call.queries,
      for (final citation in call.citations)
        if (citation.uri.isNotEmpty) citation.uri,
    ];
    if (call.degraded != null) out.add('note: ${call.degraded}');
    return out.isEmpty ? null : out.take(12).toList();
  }

  static String? _opt(String value) => value.isEmpty ? null : value;

  static String _date(DateTime utc) =>
      '${utc.day.toString().padLeft(2, '0')}/'
      '${utc.month.toString().padLeft(2, '0')}/${utc.year} '
      '${utc.hour.toString().padLeft(2, '0')}:${utc.minute.toString().padLeft(2, '0')} UTC';
}

class _Plan {
  const _Plan({
    required this.headline,
    required this.whatYouCanDo,
    required this.steps,
    required this.authorities,
    required this.drafts,
    required this.expectations,
    required this.referralNote,
  });

  final String headline;
  final List<String> whatYouCanDo;
  final List<NextStep> steps;
  final List<Authority>? authorities;
  final List<DraftDocument> drafts;
  final String? expectations;
  final String? referralNote;
}
