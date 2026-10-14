import 'dart:async';

import 'package:flutter/material.dart';
import 'package:nyay_client/nyay_client.dart';

import '../browser.dart';
import '../client.dart';
import '../widgets.dart';
import 'intake_screen.dart' show stageLabel;

/// The plan, the citations under it, and the paper that comes out of it.
///
/// Two data paths, which is the point: progress arrives on the stream and tells
/// the screen *when* to look; the plan itself is read from the stored row. So a
/// reload shows the same thing, and a dropped socket cannot lose an answer.
class PlanScreen extends StatefulWidget {
  const PlanScreen({required this.reference, this.triage, this.stage, super.key});

  final String reference;
  final TriageResult? triage;
  final String? stage;

  @override
  State<PlanScreen> createState() => _PlanScreenState();
}

class _PlanScreenState extends State<PlanScreen> {
  Advice? _advice;
  String? _stage;
  bool _busy = true;
  String? _error;
  StreamSubscription<AdviceProgress>? _sub;
  Timer? _poll;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _stage = widget.stage;
    unawaited(_load());
    // Stored rows are authoritative. Poll while pending so a missed stream
    // event or reconnect does not leave the screen stuck on "Writing".
    _poll = Timer.periodic(const Duration(seconds: 3), (_) {
      if (_advice == null || _advice!.status == AdviceStatus.queued ||
          _advice!.status == AdviceStatus.running) {
        unawaited(_load(silent: true));
      }
    });
    _sub = client.advice.watch(widget.reference).listen(
      (event) {
        if (!mounted) return;
        setState(() => _stage = event.stage.name);
        if (event.stage == AdviceStage.ready || event.stage == AdviceStage.failed) {
          unawaited(_load());
        }
      },
      onError: (Object e) {
        if (mounted) setState(() => _error = 'Progress stream closed: $e');
      },
    );
  }

  @override
  void dispose() {
    _sub?.cancel();
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (_loading || !mounted) return;
    _loading = true;
    if (!silent) setState(() => _busy = true);
    try {
      final advice = await client.advice.latest(widget.reference);
      if (!mounted) return;
      setState(() {
        _advice = advice;
        _stage = switch (advice?.status) {
          AdviceStatus.ready => 'ready',
          AdviceStatus.failed => 'failed',
          AdviceStatus.queued => 'queued',
          _ => _stage == 'ready' || _stage == 'failed' ? 'writing' : _stage,
        };
        _error = null;
      });
    } on Exception catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      _loading = false;
      if (!silent && mounted) setState(() => _busy = false);
    }
  }

  Future<void> _retry() async {
    setState(() => _busy = true);
    try {
      await client.advice.retry(widget.reference);
      if (mounted) setState(() => _stage = 'queued');
      await _load(silent: true);
    } on Exception catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _download() async {
    setState(() => _busy = true);
    try {
      final bytes = await client.advice.exportPdf(widget.reference);
      await saveBytesAsFile(bytes, 'nyaysaathi-${widget.reference}.pdf');
    } on Exception catch (e) {
      if (mounted) setState(() => _error = 'Could not build the PDF: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final advice = _advice;
    final pending = advice == null || advice.status != AdviceStatus.ready;

    return Scaffold(
      appBar: AppBar(
        title: Text('Case ${widget.reference}'),
        actions: [
          IconButton(
            tooltip: 'Download the one-page brief',
            onPressed: pending || _busy ? null : _download,
            icon: const Icon(Icons.download_rounded),
          ),
          IconButton(
            tooltip: 'Re-run the plan',
            onPressed: _busy ? null : _retry,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: RefreshIndicator(
            onRefresh: _load,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 48),
              children: [
                if (_stage != null) ...[
                  StageChips(reached: _stage),
                  const SizedBox(height: 16),
                ],
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: _Error(message: _error!, onRetry: _retry),
                  ),
                if (pending && advice?.status == AdviceStatus.failed)
                  _Pending(
                    title: 'The model could not finish',
                    detail: advice?.errorMessage ?? 'No reason was recorded.',
                    action: _retry,
                  )
                else if (pending)
                  _Pending(
                    title: 'Writing your plan',
                    detail: _stage == null
                        ? 'Queued. This takes a few seconds; it keeps running if you '
                            'close the tab, because it is stored as a row, not held in '
                            'this request.'
                        : '${stageLabel(_stage!)}. The answer is written to the case file '
                            'when it is validated, so a partial answer is never shown.',
                  )
                else ...[
                  ModelNotice(
                    model: advice!.model,
                    promptVersion: advice.promptVersion,
                  ),
                  const SizedBox(height: 16),
                  SectionCard(
                    title: advice.headline ?? 'Your next steps',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (final line in advice.whatYouCanDo ?? const <String>[])
                          Padding(
                            padding: const EdgeInsets.only(bottom: 6),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('• '),
                                Expanded(child: Text(line, style: theme.textTheme.bodyMedium)),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  SectionCard(
                    title: 'In order',
                    subtitle: 'each step names who it goes to, and which provision it rests on',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (var i = 0; i < (advice.steps ?? const <NextStep>[]).length; i++)
                          _Step(index: i + 1, step: (advice.steps ?? const <NextStep>[])[i]),
                      ],
                    ),
                  ),
                  if (advice.drafts != null && advice.drafts!.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    for (final draft in advice.drafts!)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 16),
                        child: _Draft(draft: draft),
                      ),
                  ],
                  if (advice.expectations != null) ...[
                    const SizedBox(height: 4),
                    SectionCard(
                      title: 'What happens next',
                      child: Text(advice.expectations!, style: theme.textTheme.bodyMedium),
                    ),
                  ],
                  if (advice.referralNote != null) ...[
                    const SizedBox(height: 16),
                    SectionCard(
                      title: 'When to get a human',
                      child: Text(advice.referralNote!, style: theme.textTheme.bodyMedium),
                    ),
                  ],
                  const SizedBox(height: 16),
                  _Authorities(advice: advice),
                  const SizedBox(height: 16),
                  SectionCard(
                    title: 'Take this with you',
                    subtitle: 'built on the server from the rows on this screen',
                    child: Wrap(
                      spacing: 12,
                      runSpacing: 12,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        FilledButton.icon(
                          onPressed: _busy ? null : _download,
                          icon: const Icon(Icons.picture_as_pdf_outlined),
                          label: const Text('Download the brief (PDF)'),
                        ),
                        const SizedBox(width: 12),
                        if (widget.triage != null)
                          Text(
                            'risk ${widget.triage!.riskScore}/100',
                            style: theme.textTheme.bodySmall,
                          ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.index, required this.step});

  final int index;
  final NextStep step;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final where = [
      if (step.who != null) step.who!,
      if (step.where != null) step.where!,
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 22,
                height: 22,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: theme.colorScheme.primaryContainer,
                  shape: BoxShape.circle,
                ),
                child: Text('$index',
                    style: theme.textTheme.labelMedium
                        ?.copyWith(color: theme.colorScheme.onPrimaryContainer)),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(step.title, style: theme.textTheme.titleSmall),
              ),
              if (step.byWhen != null)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: theme.colorScheme.outlineVariant),
                  ),
                  child: Text(step.byWhen!, style: theme.textTheme.labelSmall),
                ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(left: 32, top: 4),
            child: Text(step.detail, style: theme.textTheme.bodyMedium),
          ),
          if (where.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(left: 32, top: 2),
              child: Text(where, style: theme.textTheme.bodySmall),
            ),
          if (step.documents != null && step.documents!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(left: 32, top: 6),
              child: Wrap(
                spacing: 6,
                runSpacing: 4,
                children: [
                  for (final doc in step.documents!)
                    Chip(
                      label: Text(doc, style: const TextStyle(fontSize: 11)),
                      visualDensity: VisualDensity.compact,
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _Draft extends StatelessWidget {
  const _Draft({required this.draft});

  final DraftDocument draft;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SectionCard(
      title: draft.kind,
      subtitle: draft.to == null ? null : 'to: ${draft.to}',
      trailing: IconButton(
        tooltip: 'Copy',
        icon: const Icon(Icons.copy_rounded, size: 18),
        onPressed: () async {
          try {
            await copyText(draft.body);
            if (context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Copied. Fill the [BRACKETS] before sending.')),
              );
            }
          } on Object {
            if (context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Clipboard unavailable. Select and copy the text below.')),
              );
            }
          }
        },
      ),
      child: SelectableText(draft.body, style: theme.textTheme.bodyMedium?.copyWith(height: 1.5)),
    );
  }
}

class _Authorities extends StatelessWidget {
  const _Authorities({required this.advice});

  final Advice advice;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final authorities = advice.authorities ?? const <Authority>[];
    return SectionCard(
      title: 'What this rests on',
      subtitle: authorities.isEmpty
          ? 'No source was cited. Confirm the proposed steps with a professional.'
          : '${authorities.length} provision(s), each copied from the statute index',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final authority in authorities)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      SourceChip(
                        code: authority.code,
                        title: authority.title,
                        needsVerification: authority.needsVerification,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(authority.title, style: theme.textTheme.titleSmall),
                      ),
                    ],
                  ),
                  Text(
                    authority.verbatim ?? authority.gist,
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontStyle: FontStyle.italic,
                    ),
                  ),
                  SelectableLink(authority.sourceUrl),
                  if (authority.needsVerification)
                    Text(
                      'Wording not yet checked against the official text.',
                      style: theme.textTheme.labelSmall
                          ?.copyWith(color: theme.colorScheme.tertiary),
                    ),
                ],
              ),
            ),
          if (advice.groundingQueries != null && advice.groundingQueries!.isNotEmpty) ...[
            const Divider(height: 24),
            Text('Model search metadata and notes',
                style: theme.textTheme.labelLarge),
            for (final query in advice.groundingQueries!)
              Text(query, style: theme.textTheme.bodySmall),
          ],
        ],
      ),
    );
  }
}

class SelectableLink extends StatelessWidget {
  const SelectableLink(this.url, {super.key});

  final String url;

  @override
  Widget build(BuildContext context) {
    return SelectableText(
      url,
      style: TextStyle(
        fontSize: 12,
        color: Theme.of(context).colorScheme.primary,
        decoration: TextDecoration.underline,
      ),
    );
  }
}

class _Pending extends StatelessWidget {
  const _Pending({required this.title, required this.detail, this.action});

  final String title;
  final String detail;
  final VoidCallback? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SectionCard(
      title: title,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const SizedBox(
                width: 15,
                height: 15,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              const SizedBox(width: 10),
              Expanded(child: Text(detail, style: theme.textTheme.bodyMedium)),
            ],
          ),
          if (action != null) ...[
            const SizedBox(height: 12),
            FilledButton.tonal(onPressed: action, child: const Text('Try again now')),
          ],
        ],
      ),
    );
  }
}

class _Error extends StatelessWidget {
  const _Error({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.errorContainer,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(message, style: theme.textTheme.bodySmall),
          ),
          TextButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}
