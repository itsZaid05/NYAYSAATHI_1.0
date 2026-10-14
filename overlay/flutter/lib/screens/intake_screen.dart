import 'dart:async';

import 'package:flutter/material.dart';
import 'package:nyay_client/nyay_client.dart';

import '../browser.dart';
import '../client.dart';
import '../widgets.dart';
import 'plan_screen.dart';

/// The one screen a person sees before there is a plan.

/// Human label for a stage name coming off the stream.
String stageLabel(String stage) => switch (stage) {
      'queued' => 'Queued',
      'retrieving' => 'Finding the law',
      'writing' => 'Writing the steps',
      'validating' => 'Checking citations',
      'persisting' => 'Saving your file',
      'ready' => 'Ready',
      'failed' => 'Could not finish',
      _ => stage,
    };
///
/// Three states, all driven by the server's answer: describe it, answer what it
/// asks, send it. Nothing is decided in the widget — the domain, the urgency, the
/// risk and the next question all come back on [TriageResult].
class IntakeScreen extends StatefulWidget {
  const IntakeScreen({super.key});

  @override
  State<IntakeScreen> createState() => _IntakeScreenState();
}

class _IntakeScreenState extends State<IntakeScreen> {
  static const _minimumNarrative = 40;

  final _controller = TextEditingController();
  final _answerControllers = <String, TextEditingController>{};

  TriageResult? _result;
  String? _reference;
  bool _busy = false;
  String? _error;
  int _questionIndex = 0;
  StreamSubscription<AdviceProgress>? _progress;
  String? _stage;

  @override
  void initState() {
    super.initState();
    _resume();
  }

  Future<void> _resume() async {
    final stored = readStoredReference();
    if (stored == null) return;
    setState(() {
      _busy = true;
      _reference = stored;
    });
    try {
      final progress = await client.intake.progress(stored);
      final legalCase = await client.advice.caseFile(stored);
      if (!mounted) return;
      setState(() {
        _result = TriageResult(
          caseId: progress.caseId,
          reference: legalCase.reference,
          domain: legalCase.domain,
          urgency: legalCase.urgency,
          summary: legalCase.summary,
          riskScore: legalCase.riskScore,
          riskFactors: legalCase.riskFactors ?? const [],
          missingEvidence: legalCase.missingEvidence ?? const [],
          completeness: legalCase.completeness,
          timeSensitivity: legalCase.timeSensitivity,
          safetyEscalation: legalCase.safetyEscalation,
          promptVersion: legalCase.promptVersion,
        );
        _controller.text = legalCase.narrative;
      });
      await _gotoPlanIfReady(stored);
    } on Exception catch (e) {
      if (mounted) setState(() => _error = 'Could not reopen your case: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Opens the file, or re-runs triage on the existing one if there is one.
  Future<void> _open() async {
    final text = _controller.text.trim();
    if (text.length < _minimumNarrative) {
      setState(() => _error =
          'A little more detail, please - about ${_minimumNarrative - text.length} '
          'more characters is enough to start.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final existing = _reference;
      final result = existing == null
          ? await client.intake.open(text)
          : await client.intake.revise(existing, text);
      if (!mounted) return;
      setState(() {
        _result = result;
        _reference = result.reference;
        _questionIndex = 0;
      });
      storeReference(result.reference);
    } on Exception catch (e) {
      if (mounted) setState(() => _error = _readable(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _answer(String questionId) async {
    final reference = _reference;
    final text = _answerControllers[questionId]?.text.trim() ?? '';
    if (reference == null) return;
    if (text.isEmpty) {
      setState(() => _error = 'Answer this one, or tap "Skip" below.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await client.intake.answer(reference, questionId, text);
      if (!mounted) return;
      setState(() {
        _result = result;
        _questionIndex = 0;
      });
    } on Exception catch (e) {
      if (mounted) setState(() => _error = _readable(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _next() {
    final questions = _result?.questions ?? const [];
    setState(() => _questionIndex = (_questionIndex + 1).clamp(0, questions.length));
  }

  /// Queues the plan, then follows the stage channel while it is written.
  Future<void> _writePlan() async {
    final reference = _reference;
    if (reference == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await client.corpus.seed();
      await client.advice.queue(reference);
      _progress?.cancel();
      _progress = client.advice.watch(reference).listen((event) {
        if (mounted) setState(() => _stage = event.stage.name);
      });
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => PlanScreen(
            reference: reference,
            triage: _result,
            stage: _stage,
          ),
        ),
      );
      _progress?.cancel();
      _progress = null;
    } on Exception catch (e) {
      if (mounted) setState(() => _error = _readable(e));
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _stage = null;
        });
      }
    }
  }

  /// A stored plan should not make the user press a button twice.
  Future<void> _gotoPlanIfReady(String reference) async {
    final advice = await client.advice.latest(reference);
    if (!mounted) return;
    if (advice != null && advice.status == AdviceStatus.ready) {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => PlanScreen(reference: reference, triage: _result, stage: 'ready'),
        ),
      );
    }
  }

  @override
  void dispose() {
    _progress?.cancel();
    _controller.dispose();
    for (final controller in _answerControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final result = _result;
    final questions = result?.questions ?? const <IntakeQuestion>[];
    final showingQuestion = result != null && questions.isNotEmpty && _questionIndex < questions.length;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 28, 20, 40),
              children: [
                Row(
                  children: [
                    Icon(Icons.balance_outlined, color: theme.colorScheme.primary),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text('NyaySaathi', style: theme.textTheme.headlineSmall),
                    ),
                    if (_reference != null)
                      Text(
                        _reference!,
                        style: theme.textTheme.labelSmall?.copyWith(letterSpacing: 0.4),
                      ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  'Describe the problem in your own words. This is legal '
                  'information, not legal advice, and nothing you type here is '
                  'shared with anyone but this server.',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 20),
                if (result?.safetyEscalation ?? false)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: _SafetyCard(reference: _reference),
                  ),
                SectionCard(
                  title: result == null ? 'What happened' : 'Your description',
                  subtitle: result == null
                      ? 'Dates, who was involved, what you already tried.'
                      : 'Edit it and re-run if anything is wrong.',
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      TextField(
                        controller: _controller,
                        enabled: !_busy,
                        minLines: result == null ? 6 : 3,
                        maxLines: 12,
                        decoration: const InputDecoration(
                          hintText: 'For example: my manager has been sending me '
                              'messages for eight weeks. I complained in writing on '
                              '2 July and nothing has happened since.',
                        ),
                        onChanged: (_) {
                          if (result != null) setState(() {});
                        },
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          FilledButton(
                            onPressed: _busy ? null : _open,
                            child: Text(result == null ? 'Sort this out' : 'Re-run triage'),
                          ),
                          const SizedBox(width: 10),
                          if (_busy)
                            const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          else if (result != null && _stage != null)
                            Flexible(child: Text('Writing: $_stage',
                                style: theme.textTheme.bodySmall)),
                        ],
                      ),
                    ],
                  ),
                ),
                if (result != null) ...[
                  const SizedBox(height: 16),
                  _TriageCard(result: result, busy: _busy),
                ],
                if (showingQuestion) ...[
                  const SizedBox(height: 16),
                  SectionCard(
                    title: 'Question ${_questionIndex + 1} of ${questions.length}',
                    subtitle: questions[_questionIndex].why,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(questions[_questionIndex].prompt,
                            style: theme.textTheme.titleSmall),
                        const SizedBox(height: 10),
                        TextField(
                          controller: _answerControllers.putIfAbsent(
                            questions[_questionIndex].id,
                            () => TextEditingController(),
                          ),
                          enabled: !_busy,
                          minLines: 3,
                          maxLines: 8,
                          decoration: const InputDecoration(hintText: 'Your answer'),
                        ),
                        const SizedBox(height: 10),
                        Row(
                          children: [
                            FilledButton(
                              onPressed: _busy
                                  ? null
                                  : () => _answer(questions[_questionIndex].id),
                              child: const Text('Answer'),
                            ),
                            const SizedBox(width: 8),
                            TextButton(
                              onPressed: _busy ? null : _next,
                              child: const Text('Skip'),
                            ),
                            const Spacer(),
                            TextButton(
                              onPressed: _busy ? null : _writePlan,
                              child: const Text('Enough - write my plan'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ] else if (result != null) ...[
                  const SizedBox(height: 16),
                  Align(
                    alignment: Alignment.centerRight,
                    child: FilledButton.icon(
                      onPressed: _busy ? null : _writePlan,
                      icon: const Icon(Icons.auto_awesome),
                      label: Text(_stage == null
                          ? 'Write my plan'
                          : 'In plan: ${stageLabel(_stage)}'),
                    ),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  _ErrorCard(
                    message: _error!,
                    onRetry: _open,
                    onDismiss: () => setState(() => _error = null),
                  ),
                ],
                if (_reference != null) ...[
                  const SizedBox(height: 24),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Keep this reference. It is the only way back into this file.',
                        style: theme.textTheme.bodySmall,
                      ),
                      TextButton(
                        onPressed: () {
                          forgetReference();
                          setState(() {
                            _reference = null;
                            _result = null;
                            _questionIndex = 0;
                          });
                          _controller.clear();
                        },
                        child: const Text('Start a new file'),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  static String _readable(Object error) {
    final text = '$error';
    if (text.contains('AdviceUnavailableException')) {
      final reason = RegExp(r'reason=([^}]+)').firstMatch(text)?.group(1)?.trim();
      return reason == null
          ? 'The model could not answer. Your description is saved - try again.'
          : '$reason. Your description is saved, so nothing was lost.';
    }
    if (text.contains('Client') || text.contains('SocketException')) {
      return 'Cannot reach the server. Is `serverpod start` running?';
    }
    return text.length > 240 ? '${text.substring(0, 240)}…' : text;
  }
}

class _TriageCard extends StatelessWidget {
  const _TriageCard({required this.result, required this.busy});

  final TriageResult result;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tone = switch (result.riskScore) {
      >= 70 => RiskTone.danger,
      >= 45 => RiskTone.act,
      >= 25 => RiskTone.watch,
      _ => RiskTone.calm,
    };
    return SectionCard(
      title: 'How this was sorted',
      subtitle: busy ? 're-running…' : 'server-side triage, not a guess',
      trailing: RiskBadge(
        score: result.riskScore,
        label: switch (result.urgency) {
          Urgency.emergency => 'act now',
          Urgency.urgent => 'this week',
          Urgency.soon => 'this month',
          Urgency.planning => 'no clock',
        },
        tone: tone,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(result.summary ?? '(no summary)', style: theme.textTheme.bodyMedium),
          const SizedBox(height: 12),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              Chip(label: Text('area: ${result.domain.name}'), visualDensity: VisualDensity.compact),
              Chip(label: Text('urgency: ${result.urgency.name}'), visualDensity: VisualDensity.compact),
              Chip(label: Text('${result.completeness}% complete'), visualDensity: VisualDensity.compact),
            ],
          ),
          if (result.riskFactors.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text('Why the risk is what it is', style: theme.textTheme.labelLarge),
            for (final factor in result.riskFactors)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('• '),
                    Expanded(child: Text(factor, style: theme.textTheme.bodySmall)),
                  ],
                ),
              ),
          ],
          if (result.missingEvidence.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text('Still needed', style: theme.textTheme.labelLarge),
            for (final gap in result.missingEvidence)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('• '),
                    Expanded(child: Text(gap, style: theme.textTheme.bodySmall)),
                  ],
                ),
              ),
          ],
          if (result.timeSensitivity != null) ...[
            const SizedBox(height: 12),
            Text('The clock', style: theme.textTheme.labelLarge),
            Text(result.timeSensitivity!, style: theme.textTheme.bodySmall),
          ],
        ],
      ),
    );
  }
}

class _SafetyCard extends StatelessWidget {
  const _SafetyCard({this.reference});

  final String? reference;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFB3261E).withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFB3261E).withValues(alpha: 0.45)),
      ),
      child: Row(
        children: [
          const Icon(Icons.emergency_outlined, color: Color(0xFFB3261E)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'This looks unsafe right now. Call 112 if you are in danger, or 181 '
              'for shelter and legal aid. Do that before anything on this screen.',
              style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.message, this.onRetry, this.onDismiss});

  final String message;
  final VoidCallback? onRetry;
  final VoidCallback? onDismiss;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SectionCard(
      title: 'Not finished',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(message, style: theme.textTheme.bodyMedium),
          const SizedBox(height: 10),
          Row(
            children: [
              if (onRetry != null)
                FilledButton.tonal(onPressed: onRetry, child: const Text('Try again')),
              const SizedBox(width: 8),
              if (onDismiss != null)
                TextButton(onPressed: onDismiss, child: const Text('Dismiss')),
            ],
          ),
        ],
      ),
    );
  }
}
