import 'package:flutter/material.dart';

/// The four drawing primitives every screen uses. Kept in one file so the two
/// screens stay readable and the visual language cannot drift.

class SectionCard extends StatelessWidget {
  const SectionCard({
    required this.title,
    required this.child,
    this.subtitle,
    this.trailing,
    super.key,
  });

  final String title;
  final Widget child;
  final String? subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: theme.colorScheme.outlineVariant),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title, style: theme.textTheme.titleMedium),
                      if (subtitle != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(
                            subtitle!,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                if (trailing != null) trailing!,
              ],
            ),
            const SizedBox(height: 12),
            child,
          ],
        ),
      ),
    );
  }
}

enum RiskTone { calm, watch, act, danger }

class RiskBadge extends StatelessWidget {
  const RiskBadge({required this.score, this.label, this.tone = RiskTone.calm, super.key});

  final int score;
  final String? label;
  final RiskTone tone;

  Color get _color => switch (tone) {
        RiskTone.calm => const Color(0xFF2E7D5B),
        RiskTone.watch => const Color(0xFFB08300),
        RiskTone.act => const Color(0xFFB4541A),
        RiskTone.danger => const Color(0xFFB3261E),
      };

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: _color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: _color.withValues(alpha: 0.5)),
      ),
      child: Text(
        label == null ? 'risk $score/100' : '$label • risk $score/100',
        style: TextStyle(color: _color, fontWeight: FontWeight.w600, fontSize: 12),
      ),
    );
  }
}

class SourceChip extends StatelessWidget {
  const SourceChip({
    required this.code,
    required this.title,
    this.needsVerification = false,
    this.onTap,
    super.key,
  });

  final String code;
  final String title;
  final bool needsVerification;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Tooltip(
      message: needsVerification
          ? '$title — the wording here has not been checked against the official '
              'text yet. Verify before repeating the number.'
          : title,
      child: ActionChip(
        avatar: Icon(
          needsVerification ? Icons.rule : Icons.account_balance,
          size: 16,
          color: needsVerification ? theme.colorScheme.tertiary : theme.colorScheme.primary,
        ),
        label: Text(code, style: const TextStyle(fontFeatures: [FontFeature.tabularFigures()])),
        onPressed: onTap,
      ),
    );
  }
}

/// The stages the server publishes while a plan is written. Rendered from the
/// stream, so the user can see it working instead of wondering.
class StageChips extends StatelessWidget {
  const StageChips({required this.reached, super.key});

  /// The last stage name the server reported, or null before the first event.
  final String? reached;

  static const _order = <String, String>{
    'queued': 'Queued',
    'retrieving': 'Finding the law',
    'writing': 'Writing the steps',
    'validating': 'Checking citations',
    'persisting': 'Saving your file',
    'ready': 'Ready',
    'failed': 'Could not finish',
  };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final keys = _order.keys.toList();
    final at = reached == null ? -1 : keys.indexOf(reached!);
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: [
        for (var i = 0; i < keys.length; i++)
          AnimatedContainer(
            duration: const Duration(milliseconds: 260),
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
            decoration: BoxDecoration(
              color: i <= at && keys[i] != 'failed'
                  ? theme.colorScheme.primaryContainer
                  : theme.colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (i == at && keys[i] != 'ready' && keys[i] != 'failed')
                  const SizedBox(
                    width: 11,
                    height: 11,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                else if (i < at || keys[i] == 'ready')
                  Icon(Icons.check, size: 13, color: theme.colorScheme.onPrimaryContainer)
                else
                  Icon(Icons.circle_outlined,
                      size: 13, color: theme.colorScheme.onSurfaceVariant),
                const SizedBox(width: 5),
                Text(
                  _order[keys[i]]!,
                  style: TextStyle(
                    fontSize: 12,
                    color: i <= at
                        ? theme.colorScheme.onPrimaryContainer
                        : theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

/// The line every generated surface carries: who wrote it, from which prompt, and
/// that it is not advice.
class ModelNotice extends StatelessWidget {
  const ModelNotice({required this.model, required this.promptVersion, super.key});

  final String? model;
  final String? promptVersion;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final live = model != null;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: live ? theme.colorScheme.secondaryContainer : const Color(0xFFFFF1C9),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Icon(live ? Icons.auto_awesome_outlined : Icons.wifi_off_rounded, size: 16),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              live
                  ? 'Written by $model (prompt ${promptVersion ?? '?'}), from the '
                      'statute index below. Legal information, not legal advice - no '
                      'outcome is promised.'
                  : 'The model is not answering right now, so this plan came from '
                      'recorded sample answers. Everything else (retrieval, citations, '
                      'storage) is the real code path.',
              style: theme.textTheme.bodySmall,
            ),
          ),
        ],
      ),
    );
  }
}
