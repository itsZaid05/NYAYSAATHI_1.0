/// Recorded answers, used when there is no API key or `NYAY_OFFLINE=1`.
///
/// These stand in for the model, never for the engine: retrieval, schema
/// validation, citation filtering, risk scoring and storage all still run.
/// Replace them by recording real responses (the `log` line the engine prints
/// names the case) so the offline path reflects what the model actually says.
const kFixtureAnswers = <String, Map<String, Object?>>{
  'intake analyst': {
    'domain': 'workplace',
    'urgency': 'urgent',
    'summary':
        'You were sent repeated unwelcome messages by a manager and the Internal '
        'Committee has not acknowledged your written complaint since 2 July. '
        'If you are being followed or threatened, call 112 now.',
    'keyFacts': [
      'Eight weeks of unwelcome messages from a manager',
      'Written complaint to the Internal Committee on 2 July',
      'No acknowledgement or inquiry started',
      'Employer appears to have an Internal Committee',
    ],
    'missingEvidence': [
      'Copies of the messages, with dates',
      'The complaint as sent, and any reply',
      'The name of the Internal Committee chair or the External Member',
      'Your appointment letter or the policy that names the committee',
    ],
    'questions': [
      {
        'id': 'q-documents',
        'prompt': 'Do you still have the messages and your complaint, in a form you '
            'can print or forward?',
        'why': 'The committee can act on a written record; without it the date of the '
            'complaint is your word against the employer\'s.',
      },
      {
        'id': 'q-committee',
        'prompt': 'Did you send it to the Internal Committee\'s address, and do you '
            'know who chairs it?',
        'why': 'A complaint to a manager or HR is not a complaint to the committee, and '
            'that changes what to do first.',
      },
      {
        'id': 'q-retaliation',
        'prompt': 'Since you complained, has anything changed about your work — '
            'shifts, targets, leave, or being left out of meetings?',
        'why': 'Retaliation can be raised as interim relief now; it does not have to '
            'wait for the inquiry to finish.',
      },
    ],
    'timeSensitivity':
        'The complaint window is three months from the last incident, extendable by '
        'three for a good reason - check the date of the message you would rely on.',
    'domainConfidence': 0.86,
    'safetyEscalation': false,
    'statuteUnclear': false,
  },
  'action-plan writer': {
    'headline': 'Put the complaint on the record, then ask for interim relief',
    'whatYouCanDo': [
      'Send the complaint again, in writing, addressed to the Internal Committee, '
          'and keep proof of sending.',
      'Ask in the same letter for the respondent to be kept away from your work while '
          'the inquiry runs.',
      'If the committee does not exist or does not act, complain to the District Officer '
          'or the Local Committee, and use free legal aid if you need a lawyer.',
    ],
    'steps': [
      {
        'title': 'Rebuild the paper trail before anything else',
        'detail': 'Print or export the messages with dates visible, write a one-page '
            'chronology, and save the complaint as you sent it. Do not edit the '
            'screenshots. This is what the committee will ask for on day one.',
        'who': 'You',
        'where': 'At home, before the next email',
        'byWhen': 'This week',
        'documents': ['message screenshots', 'the complaint as sent', 'any reply'],
        'authorityIndex': 1,
      },
      {
        'title': 'Send a written reminder to the Internal Committee',
        'detail': 'One page: what you complained about, the date you sent it, that no '
            'acknowledgement has been received, and that you now want the inquiry '
            'convened and a date for the first hearing. Send it by a method that '
            'produces proof of delivery and copy the External Member.',
        'who': 'Internal Committee (chair) and the External Member',
        'where': 'To the committee address in your policy, plus HR for the record',
        'byWhen': 'Within 7 days',
        'documents': ['chronology', 'proof the first complaint was sent'],
        'authorityIndex': 1,
      },
      {
        'title': 'Ask for interim relief in the same letter',
        'detail': 'Say plainly what you need - that the respondent not supervise you, '
            'or that you be allowed to work remotely, or leave without pay cutting - '
            'and that you ask for it before the inquiry concludes, because the Act '
            'allows that.',
        'who': 'Internal Committee',
        'where': 'In the letter above',
        'byWhen': 'With the reminder',
        'authorityIndex': 3,
      },
      {
        'title': 'If nothing moves in 30 days, go outside the company',
        'detail': 'Where the committee has fewer than the required members, or has not '
            'acted, the complaint can go to the Local Committee at the District '
            'Officer. Attach the reminder and the missing acknowledgement. If your '
            'state\'s rules publish an online form, use it, because it timestamps the '
            'filing for you.',
        'who': 'District Officer / Local Committee',
        'where': 'District offices or the state women-and-child development portal',
        'byWhen': '30 days after the reminder',
        'documents': ['the reminder', 'proof of delivery', 'the chronology'],
        'authorityIndex': 1,
      },
      {
        'title': 'Get free help if you want a lawyer',
        'detail': 'A woman complaining of sexual harassment is entitled to free legal '
            'aid. Apply at the District Legal Services Authority in the district courts '
            'complex; take the complaint, the messages and your ID. They can also waive '
            'the cost of anything you later file.',
        'who': 'District Legal Services Authority',
        'where': 'District and Taluk Legal Services Committees',
        'byWhen': 'Any time; do it before the first hearing if you can',
        'authorityIndex': 6,
      },
    ],
    'authorities': [
      {'index': 1, 'reliedOn': 'duty to constitute the Internal Committee'},
      {'index': 3, 'reliedOn': 'interim relief during or before the inquiry'},
      {'index': 6, 'reliedOn': 'free legal services for victims of abuse'},
    ],
    'drafts': [
      {
        'kind': 'Reminder to the Internal Committee',
        'to': 'Chair, Internal Committee',
        'body': 'I wrote to the committee on [DATE OF FIRST COMPLAINT] about conduct by '
            '[NAME OF RESPONDENT] between [START] and [END]. I have received no '
            'acknowledgement and no hearing date. I ask that the inquiry be convened and '
            'a date fixed within 15 days, and that pending the inquiry [the respondent] '
            'be relieved of supervising my work. I have kept the messages and the proof '
            'of sending and will produce them. My complaint and its annexures are the '
            'same as before. - [YOUR NAME], [EMPLOYEE ID]',
      },
    ],
    'expectations': 'A committee is expected to finish the inquiry in about 90 days and '
        'to tell both parties the outcome; timelines slip in practice, which is why the '
        'written reminder matters - it puts the delay on record. Nobody can promise a '
        'finding from here.',
    'referralNote': 'If the messages contain threats, or you are being followed, speak to '
        'a lawyer or the police before you send anything: a protection order can be sought '
        'the same day, and it is faster than any workplace inquiry.',
  },
};
