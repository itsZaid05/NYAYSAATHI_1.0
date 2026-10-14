import '../generated/protocol.dart';

/// Risk is arithmetic, not opinion.
///
/// A model would score the same facts differently on two runs, and this number
/// decides whether the app shouts "call 112" or "file this month". So it is
/// computed here from the stored case fields, which means a re-run gives the same
/// answer and a test can pin it.
class RiskAssessment {
  const RiskAssessment({required this.score, required this.factors, required this.escalate});

  final int score;
  final List<String> factors;
  final bool escalate;

  String get label => switch (score) {
        >= 70 => 'Act now',
        >= 45 => 'Time-sensitive',
        >= 25 => 'Start this week',
        _ => 'No immediate clock',
      };
}

const _weights = (
  safety: 35,
  emergencyUrgency: 20,
  urgent: 15,
  thinEvidence: 15,
  noDocuments: 10,
  lowConfidence: 5,
);

RiskAssessment assessRisk({
  required Urgency urgency,
  required bool safetyEscalation,
  required int missingEvidenceCount,
  required bool hasDeadline,
  required bool hasDocuments,
  required double domainConfidence,
}) {
  var score = 0;
  final factors = <String>[];

  if (safetyEscalation) {
    score += _weights.safety;
    factors.add('Safety is at risk right now');
  }
  if (urgency == Urgency.emergency) {
    score += _weights.emergencyUrgency;
    factors.add('Something may be lost or hurt within days');
  } else if (urgency == Urgency.urgent) {
    score += _weights.urgent;
    factors.add('There is a short window to act');
  }
  if (hasDeadline) {
    score += _weights.emergencyUrgency - 5;
    factors.add('A filing or response deadline is close');
  }
  if (missingEvidenceCount >= 3) {
    score += _weights.thinEvidence;
    factors.add('The facts are thin - $missingEvidenceCount things still need to be gathered');
  }
  if (!hasDocuments) {
    score += _weights.noDocuments;
    factors.add('No documents or messages mentioned yet');
  }
  if (domainConfidence < 0.5) {
    score += _weights.lowConfidence;
    factors.add('The area of law is not certain from what you wrote');
  }

  final capped = score > 100 ? 100 : score;
  return RiskAssessment(
    score: capped,
    factors: factors,
    escalate: safetyEscalation || urgency == Urgency.emergency,
  );
}
