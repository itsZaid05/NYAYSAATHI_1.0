import 'package:serverpod/serverpod.dart';

import '../generated/protocol.dart';
import '../services/corpus_service.dart';

/// The index the engine is allowed to cite, exposed on purpose.
///
/// The Sources screen shows a user what retrieval found for their own facts,
/// with the score and the reason each provision matched. Making that readable is
/// cheaper than asking people to trust a citation list.
class CorpusEndpoint extends Endpoint {
  Future<int> count(Session session) async => LegalProvision.db.count(session);

  Future<int> seed(Session session) async => CorpusService.seed(session);

  /// What the retriever would hand the model for this text.
  Future<List<CorpusHit>> search(
    Session session,
    String query,
    String? domain,
  ) async {
    LegalDomain? parsed;
    if (domain != null && domain.isNotEmpty) {
      parsed = LegalDomain.values.firstWhere(
        (value) => value.name == domain.toLowerCase(),
        orElse: () => LegalDomain.other,
      );
    }
    const service = CorpusService();
    final hits = await service.retrieve(session: session, query: query, domain: parsed);
    return [
      for (final hit in hits)
        CorpusHit(
          code: hit.provision.code,
          title: hit.provision.title,
          gist: hit.provision.gist,
          sourceUrl: hit.provision.sourceUrl,
          score: hit.score,
          matchedBy: hit.matchedBy,
          needsVerification: hit.provision.needsVerification,
        ),
    ];
  }
}
