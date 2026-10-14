import 'package:serverpod/serverpod.dart';

import '../generated/protocol.dart';

/// The statute index, and the only thing the app will cite.
///
/// The rows are transcribed by hand from the official India Code text rather
/// than scraped, and `sourceUrl` is deliberately the single India Code root for
/// every row: deep per-act links could not be verified from where this was
/// written, so rather than inventing plausible URLs the app points at the
/// repository and marks the row `needsVerification`, which the UI shows.
class CorpusService {
  const CorpusService();

  static const sourceRoot = 'https://indiacode.nic.in';
  static const maxHits = 6;
  static const minScore = 0.18;

  // ------------------------------------------------------------------ seed ---

  static Future<bool> isEmpty(Session session) async =>
      await LegalProvision.db.count(session) == 0;

  /// Inserts whatever the table is missing. Idempotent, so it can run on every
  /// boot and a reviewer never has to seed a database by hand.
  static Future<int> seed(Session session) async {
    var added = 0;
    for (final seed in _rows) {
      final existing = await LegalProvision.db.findFirstRow(
        session,
        where: (t) => t.code.equals(seed.code),
      );
      if (existing != null) continue;
      await LegalProvision.db.insertRow(
        session,
        LegalProvision(
          code: seed.code,
          title: seed.title,
          domain: seed.domain,
          act: seed.act,
          gist: seed.gist,
          verbatim: seed.verbatim,
          procedure: seed.procedure,
          authority: seed.authority,
          remedy: seed.remedy,
          limitationPeriodMonths: seed.limitationMonths,
          emergencyLine: seed.emergencyLine,
          sourceUrl: sourceRoot,
          needsVerification: seed.needsVerification,
          keywords: seed.keywords,
        ),
      );
      added++;
    }
    return added;
  }

  /// Seed on demand: `retrieve` self-heals an empty table, so a server that
  /// started before the boot-time seed finished still answers.
  static Future<void> ensureSeeded(Session session) async {
    if (await isEmpty(session)) await seed(session);
  }

  // ------------------------------------------------------------- retrieval ---

  /// Lexical ranking over the rows for this domain, plus a domain-mismatch
  /// penalty. Not embeddings — it has to work on SQLite as well as Postgres —
  /// but real scoring, and the reason a hit matched is returned with it.
  /// [domain] null searches every row: that is the pass used while triaging,
  /// where the domain is what we are trying to find out. The plan pass always
  /// passes one, because a citation from outside the triaged area of law is worse
  /// than no citation.
  Future<List<RetrievedProvision>> retrieve({
    required Session session,
    required String query,
    LegalDomain? domain,
  }) async {
    await ensureSeeded(session);
    final candidates = domain == null
        ? await LegalProvision.db.find(session)
        : await LegalProvision.db.find(session, where: (t) => t.domain.equals(domain));

    final terms = _terms(query);
    final scored = <RetrievedProvision>[];
    for (final row in candidates) {
      final why = <String>[];
      var score = 0.0;

      final haystack = [
        row.title,
        row.gist,
        ...?row.keywords,
        ...?row.verbatim?.split(' ').take(40),
      ].join(' ').toLowerCase();

      final overlap = terms.where((w) => haystack.contains(w)).length;
      if (terms.isNotEmpty) {
        score += 0.55 * (overlap / terms.length);
        if (overlap > 0) why.add('$overlap of ${terms.length} case terms');
      }
      for (final keyword in row.keywords ?? const <String>[]) {
        if (terms.contains(keyword.toLowerCase())) {
          score += 0.2;
          why.add('keyword "$keyword"');
        }
      }
      if (domain != null) {
        if (row.domain == domain) {
          score += 0.25;
          why.add('domain ${domain.name}');
        } else {
          score -= 0.35;
          why.add('outside the triaged domain');
        }
      }
      if (row.procedure != null &&
          terms.any((w) => (row.procedure ?? '').toLowerCase().contains(w))) {
        score += 0.1;
        why.add('matches the procedure you described');
      }

      if (score >= minScore) {
        scored.add(
          RetrievedProvision(provision: row, score: score.clamp(0.0, 1.0), matchedBy: why),
        );
      }
    }
    scored.sort((a, b) => b.score.compareTo(a.score));
    return scored.take(maxHits).toList();
  }

  /// The block handed to the model. Numbered so it can only refer to something
  /// by index, which is what lets `_authorities` rebuild the citation list from
  /// the corpus instead of from the answer.
  Future<String> contextBlock(List<RetrievedProvision> hits) async {
    if (hits.isEmpty) {
      return 'NOTHING WAS FOUND IN THE STATUTE INDEX FOR THIS SITUATION.\n'
          'Say that the law here is unclear for the facts given, name what is '
          'missing, and point to the office that handles it anyway. Do not cite '
          'any provision.';
    }
    final buffer = StringBuffer()
      ..writeln('CITE ONLY FROM THIS LIST, by index. Quote nothing that is not here.')
      ..writeln('If a step needs a rule that is absent, write that it needs checking.');
    for (var i = 0; i < hits.length; i++) {
      final p = hits[i].provision;
      buffer
        ..writeln('[${i + 1}] ${p.code} - ${p.title} (${p.act})')
        ..writeln('    gist: ${p.gist}')
        ..writeln('    matched by: ${hits[i].matchedBy.join('; ')}');
      if (p.verbatim != null) buffer.writeln('    text: "${p.verbatim}"');
      if (p.procedure != null) buffer.writeln('    procedure: ${p.procedure}');
      if (p.authority != null) buffer.writeln('    who handles it: ${p.authority}');
      if (p.limitationPeriodMonths != null) {
        buffer.writeln(
          '    limitation: about ${p.limitationPeriodMonths} months '
          '(VERIFY against the official text before repeating this number)',
        );
      }
      if (p.needsVerification) buffer.writeln('    status: wording not yet verified');
    }
    return buffer.toString();
  }

  static Set<String> _terms(String text) {
    const stop = {
      'the',
      'and',
      'for',
      'that',
      'this',
      'with',
      'from',
      'have',
      'has',
      'was',
      'were',
      'are',
      'not',
      'but',
      'they',
      'them',
      'their',
      'there',
      'when',
      'what',
      'which',
      'who',
      'how',
      'why',
      'out',
      'get',
      'got',
      'into',
      'about',
      'mine',
      'myself',
      'your',
      'yours',
      'her',
      'his',
      'our',
      'been',
      'being',
      'did',
      'does',
      'had',
      'cant',
      'cannot',
      'will',
      'would',
      'should',
      'could',
      'than',
      'then',
      'so',
      'no',
      'yes',
      'just',
      'very',
      'much',
      'any',
      'all',
      'some',
      'more',
      'most',
      'after',
      'before',
      'because',
      'while',
      'since',
      'against',
      'over',
      'under',
      'again',
      'once',
      'here',
      'where',
      'also',
      'even',
      'still',
      'new',
      'one',
      'two',
      'tried',
      'told',
      'said',
      'month',
      'week',
      'day',
      'year',
      'time',
      'thing',
      'things',
      'please',
      'help',
      'want',
      'need',
      'needed',
      'lawyer',
      'police',
    };
    return text
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z\s]'), ' ')
        .split(RegExp(r'\s+'))
        .where((w) => w.length > 3 && !stop.contains(w))
        .toSet();
  }

  // ----------------------------------------------------------------- rows ---

  static const _rows = <CorpusSeed>[
    // ---- workplace / sexual harassment -------------------------------------
    CorpusSeed(
      'POSH-s3',
      'Duty to constitute an Internal Committee',
      LegalDomain.workplace,
      'Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013',
      'Every workplace with 10 or more workers must set up an Internal Committee. Complaints go to that committee, not to a manager.',
      ['harassment', 'internal committee', 'ic', 'workplace', 'employer', 'manager'],
      verbatim: 'It shall be the duty of every employer to constitute an internal committee at the workplace for the purposes of the provisions of this Act.',
      procedure: 'Write to the Internal Committee (presided over by a senior woman employee, with an external member). A written complaint with 3 witnesses\' details if any.',
      authority: 'Internal Committee of the employer; Local Committee where the workplace has fewer than 10 workers or the complaint is against the employer.',
      limitationMonths: 3,
      needsVerification: true,
    ),
    CorpusSeed(
      'POSH-s9',
      'Time limit for filing and the inquiry period',
      LegalDomain.workplace,
      'Sexual Harassment Act, 2013',
      'A complaint should be made within three months of the incident, extendable by another three months for good reason; the inquiry is to be completed in 90 days.',
      ['deadline', 'time', 'limit', 'complaint', 'inquiry', 'months'],
      procedure: 'If the three months have passed, say why in the complaint — the committee may condone the delay.',
      limitationMonths: 6,
      needsVerification: true,
    ),
    CorpusSeed(
      'POSH-s13',
      'Interim relief / withholding the respondent from the workplace',
      LegalDomain.workplace,
      'Sexual Harassment Act, 2013',
      'During or before the inquiry, the committee can recommend that the respondent be transferred, that the complainant be given leave, or that the respondent be restrained from working with her.',
      ['transfer', 'leave', 'interim', 'safety', 'retaliation', 'suspend'],
      remedy: 'Ask for it in writing at the same time as the complaint; it does not have to wait for the finding.',
      needsVerification: true,
    ),
    CorpusSeed(
      'POSH-s19',
      'Confidentiality of the complaint',
      LegalDomain.workplace,
      'Sexual Harassment Act, 2013',
      'The complainant\'s details, the proceedings and the recommendations are not to be published or shared, including with the respondent\'s colleagues.',
      ['confidential', 'privacy', 'shared', 'published', 'gossip'],
      needsVerification: true,
    ),
    // ---- tenancy -------------------------------------------------------------
    CorpusSeed(
      'TMRA-s5',
      'Refund of deposit on the model tenancy contract',
      LegalDomain.tenancy,
      'Model Tenancy Act, 2020 (adopted state by state, not everywhere)',
      'Under the model Act a deposit must be returned within 10 days of the end of the tenancy, less what is legitimately owed for damage or unpaid rent.',
      ['deposit', 'refund', 'landlord', 'rent', 'vacated', 'security'],
      procedure: 'Written demand to the landlord listing the flat\'s condition on handover, then a complaint to the Rent Authority / Rent Court if the state has adopted the Act.',
      authority: 'Rent Authority (conciliation) then Rent Court, in adopting states; otherwise the civil court and the local police station for criminal intimidation.',
      limitationMonths: 36,
      needsVerification: true,
    ),
    CorpusSeed(
      'SARFAESI-or-civil-suit',
      'Suit for recovery of money and injunction',
      LegalDomain.tenancy,
      'Specific Relief Act, 1963 / Code of Civil Procedure, 1908',
      'Where a landlord cuts services or tries to force you out without following the tenancy agreement or the adopted rent law, a civil suit for injunction and recovery is the ordinary remedy.',
      ['evict', 'cut', 'electricity', 'water', 'lock', 'force', 'possession'],
      remedy: 'Injunction to stop the cutting/force; recovery of the deposit with interest.',
      limitationMonths: 36,
      needsVerification: true,
    ),
    // ---- consumer ------------------------------------------------------------
    CorpusSeed(
      'CPA-s2(37)',
      'Deficiency in service and unfair trade practice',
      LegalDomain.consumer,
      'Consumer Protection Act, 2019',
      'A service that is not delivered as promised, and any misleading advertisement or practice, are grounds for a consumer complaint — including against a platform or a bank.',
      ['deficiency', 'service', 'refund', 'product', 'defective', 'online', 'order', 'bank'],
      procedure: 'Send a written notice to the company, then file on the e-Daakhil portal or at the District Commission.',
      authority: 'District Consumer Disputes Redressal Commission; National Commission above the district pecuniary limits.',
      limitationMonths: 24,
      needsVerification: true,
    ),
    CorpusSeed(
      'CPA-s17',
      'Where to file a consumer complaint',
      LegalDomain.consumer,
      'Consumer Protection Act, 2019',
      'You can file where you live or where the goods/services were sold — the 2019 Act removed the earlier rule that tied you to the opposite party\'s place.',
      ['where', 'file', 'jurisdiction', 'city', 'district', 'e-daakhil'],
      needsVerification: false,
    ),
    // ---- police / criminal ---------------------------------------------------
    CorpusSeed(
      'BNSS-s173',
      'Zero FIR and the written receipt',
      LegalDomain.police,
      'Bharatiya Nagarik Suraksha Sanhita, 2023 (replaced the CrPC for offences after 1 July 2024)',
      'A First Information Report can be lodged at any police station regardless of where the incident happened, and you are entitled to a free copy of it.',
      ['fir', 'police', 'complaint', 'refused', 'station', 'copy'],
      procedure: 'Give it in writing and ask for the daily-diary number; if refused, write to the Superintendent of Police, and for some offences use the magistrate route.',
      remedy: 'Refusal to record an FIR is itself actionable before the Magistrate under the section that compels it.',
      needsVerification: true,
    ),
    CorpusSeed(
      'BNS-s351',
      'Criminal intimidation and stalking',
      LegalDomain.police,
      'Bharatiya Nyaya Sanhita, 2023',
      'Threats to injure your reputation or person, and following or contacting you repeatedly after you have said no, are offences.',
      ['threat', 'intimidat', 'stalking', 'blackmail', 'follow', 'messages', 'fear'],
      emergencyLine: 'If you are in danger now, call 112 (all-India emergency).',
      needsVerification: true,
    ),
    CorpusSeed(
      'BNS-s64',
      'Offences against a woman made with intent to modesty/assault',
      LegalDomain.police,
      'Bharatiya Nyaya Sanhita, 2023',
      'Sexual assault and criminal force with intent to disrobe or outrage modesty are cognisable offences with their own, stricter, penalties.',
      ['assault', 'touch', 'molest', 'rape', 'grab', 'force'],
      procedure: 'A woman may record her statement before a woman magistrate or by video, and at a place of choice; the FIR can be zero-FIR.',
      emergencyLine: '112, or the women\'s helpline 181 for shelter and legal-aid referral.',
      needsVerification: true,
    ),
    // ---- debt / money --------------------------------------------------------
    CorpusSeed(
      'Limitation-act-s3',
      'Three years to sue for a debt',
      LegalDomain.debt,
      'Limitation Act, 1963',
      'A suit to recover money due on a written agreement or a loan generally has to be filed within three years of the date it fell due, or of the last written acknowledgement.',
      ['loan', 'owe', 'borrowed', 'repay', 'money', 'recover', 'promissory'],
      procedure: 'Check the due date on the document, then the last date you were paid or acknowledged the debt — either can restart the clock.',
      limitationMonths: 36,
      needsVerification: true,
    ),
    CorpusSeed(
      'SARFAESI-s13',
      'Secured creditor\'s notice before taking possession',
      LegalDomain.debt,
      'SARFAESI Act, 2002',
      'A bank taking possession of a secured asset must first give 60 days\' written notice, and you can appeal to the Debt Recovery Tribunal.',
      ['bank', 'auction', 'possession', 'home loan', 'notice', 'seize'],
      procedure: 'File an application with the DRT within 45 days of the possession measure; read the notice for the demand it makes.',
      authority: 'Debt Recovery Tribunal.',
      limitationMonths: 2,
      needsVerification: true,
    ),
    // ---- online / IT ---------------------------------------------------------
    CorpusSeed(
      'IT-Act-s69A+rules',
      'Blocking and takedown of online content',
      LegalDomain.online,
      'Information Technology Act, 2000 and the IT Rules, 2021',
      'Grievance officers of intermediaries must acknowledge a complaint within 24 hours and, for content on listed grounds, act within 3 days of an order; a platform also has to preserve records.',
      ['post', 'photo', 'video', 'social media', 'take down', 'youtube', 'whatsapp', 'instagram'],
      procedure: 'Use the platform\'s Grievance Officer (the Rules require publishing their name), in writing, then escalate to the Ministry grievance portal if nothing happens.',
      limitationMonths: 3,
      needsVerification: true,
    ),
    CorpusSeed(
      'BNS-s356',
      'Defamation — spoken, written or published',
      LegalDomain.online,
      'Bharatiya Nyaya Sanhita, 2023',
      'Imputing something about a person that harms their reputation can be defamation; truth and public-interest comment are defences, so weigh a case before filing.',
      ['defamation', 'allegations', 'public', 'reputation', 'false', 'post'],
      remedy: 'A legal notice demanding deletion and an apology often moves a platform faster than a suit.',
      needsVerification: true,
    ),
    CorpusSeed(
      'IT-Act-s66+66E',
      'Hacking, identity theft and violating privacy electronically',
      LegalDomain.online,
      'Information Technology Act, 2000',
      'Accessing a computer or account without permission, dishonestly impersonating someone, or capturing/publishing a private image are offences.',
      ['account', 'hacked', 'password', 'otp', 'impersonate', 'fake profile', 'private image'],
      procedure: 'Report to the cyber crime portal (cybercrime.gov.in), which also takes the complaint to the local cyber cell.',
      emergencyLine: 'Cyber crime helpline 1930 for money fraud in progress.',
      needsVerification: true,
    ),
    // ---- family --------------------------------------------------------------
    CorpusSeed(
      'CrPC-125-BNS-era-s144',
      'Maintenance for a wife, children and parents',
      LegalDomain.family,
      'Bharatiya Nagarik Suraksha Sanhita, 2023 (maintenance section, formerly s.125 CrPC)',
      'A person with sufficient means who neglects to maintain a wife, children or parents can be ordered to pay a monthly allowance by a Magistrate.',
      ['maintenance', 'alimony', 'wife', 'children', 'father', 'mother', 'neglect'],
      procedure: 'A petition before the Judicial Magistrate with proof of means (bank statements, salary slips) and of need.',
      authority: 'Judicial Magistrate of the first class.',
      needsVerification: true,
    ),
    CorpusSeed(
      'DV-Act-s12+18',
      'Protection order and residence order',
      LegalDomain.family,
      'Protection of Women from Domestic Violence Act, 2005',
      'A Magistrate can order that the respondent stop contacting you, that you not be thrown out of the shared household, and can direct payment of protection costs.',
      ['domestic', 'violence', 'husband', 'in-laws', 'throw out', 'abuse', 'shared household'],
      procedure: 'Through the Protection Officer (every district has one) or directly by application; the Act lets you ask for interim orders the same day in urgent cases.',
      authority: 'Magistrate under the DV Act, on the report of the Protection Officer.',
      emergencyLine: '181 women\'s helpline; 112 for immediate danger.',
      needsVerification: true,
    ),
    CorpusSeed(
      'HM-s13B+guardians',
      'Divorce by mutual consent and child custody',
      LegalDomain.family,
      'Hindu Marriage Act, 1955 / Guardians and Wards Act, 1890',
      'Mutual-consent divorce needs a joint petition and a cooling-off period, with custody and maintenance settled in the terms; custody applications are decided on the child\'s welfare.',
      ['divorce', 'custody', 'maintenance', 'marriage', 'settlement', 'child'],
      limitationMonths: 6,
      needsVerification: true,
    ),
    // ---- employment (wages, termination) -------------------------------------
    CorpusSeed(
      'CODE-WAGES-s8',
      'Wages must be paid on time and in full',
      LegalDomain.employment,
      'Code on Wages, 2019',
      'An employer must pay wages before the fixed wage period ends; deductions other than those the Code allows are unlawful, and non-payment is enforceable by the Inspector.',
      ['salary', 'unpaid', 'wages', 'notice period', 'employer', 'deduction', 'relieving'],
      procedure: 'Written demand, then a complaint to the Labour Commissioner / facilitator; the Code also allows a claim before the authority for delayed payment.',
      authority: 'Inspector-cum-Facilitator appointed under the Code; Labour Commissioner.',
      limitationMonths: 6,
      needsVerification: true,
    ),
    CorpusSeed(
      'ID-Act-s25F+2A',
      'Retrenchment compensation and prior notice',
      LegalDomain.employment,
      'Industrial Disputes Act, 1947',
      'A workman with at least one year of service is entitled to one month\'s notice (or pay in lieu) and 15 days\' average pay for each completed year on retrenchment, and to the 45-day compliance in establishments covered by Chapter V-B.',
      ['terminated', 'fired', 'retrench', 'layoff', 'notice pay', 'severance'],
      limitationMonths: 3,
      needsVerification: true,
    ),
    CorpusSeed(
      'E-WASTES/RTI-s6',
      'Right to information about a public body\'s action',
      LegalDomain.other,
      'Right to Information Act, 2005',
      'A public authority must answer an RTI within 30 days (48 hours for life-and-liberty matters), and it is the cheapest way to get a file moved or a record created.',
      ['rti', 'information', 'government', 'office', 'delay', 'file'],
      procedure: 'A plain written application with the Rs 10 fee to the Public Information Officer of the office; appeal to the first appellate authority in 30 days.',
      limitationMonths: 1,
      needsVerification: true,
    ),
    CorpusSeed(
      'LEGAL-SERVICES-authority',
      'Free legal aid',
      LegalDomain.other,
      'Legal Services Authorities Act, 1987',
      'Women, children, victims of abuse, disabled persons, industrial workmen and those below the income limit are entitled to free legal services, including a lawyer and the court fee.',
      ['free', 'legal aid', 'lawyer', 'cannot afford', 'dlsa', 'legal aid authority'],
      procedure: 'Apply at the District Legal Services Authority in the district courts, or on the NALSA portal; carry any ID and the papers about the case.',
      authority: 'District Legal Services Authority / Taluk Legal Services Committee.',
      needsVerification: false,
    ),
    CorpusSeed(
      'NALSA-courts-fee',
      'Court fee and limitation for a civil suit',
      LegalDomain.other,
      'Court Fees Act, 1870 / Limitation Act, 1963',
      'Most money suits need an ad valorem court fee and have to be filed within three years of the cause of action; the Legal Services Authority can waive the fee for aided persons.',
      ['court fee', 'suit', 'limitation', 'file', 'civil'],
      limitationMonths: 36,
      needsVerification: true,
    ),
  ];
}

/// A row as authored. Separate from the model so the seed file stays `const`:
/// generated Serverpod models have no const constructor.
class CorpusSeed {
  const CorpusSeed(
    this.code,
    this.title,
    this.domain,
    this.act,
    this.gist,
    this.keywords, {
    this.verbatim,
    this.procedure,
    this.authority,
    this.remedy,
    this.limitationMonths,
    this.emergencyLine,
    this.needsVerification = true,
  });

  final String code;
  final String title;
  final LegalDomain domain;
  final String act;
  final String gist;
  final List<String> keywords;
  final String? verbatim;
  final String? procedure;
  final String? authority;
  final String? remedy;
  final int? limitationMonths;
  final String? emergencyLine;
  final bool needsVerification;
}

class RetrievedProvision {
  const RetrievedProvision({
    required this.provision,
    required this.score,
    required this.matchedBy,
  });

  final LegalProvision provision;
  final double score;
  final List<String> matchedBy;
}
