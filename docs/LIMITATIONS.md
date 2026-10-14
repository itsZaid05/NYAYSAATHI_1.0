# Limitations and privacy boundaries

## Build status

The recovered Dart/Flutter sources have **not been compiled or run in this
session**. Generated packages, a database migration, and toolchain output are not
yet committed. Source-level fixes do not establish compatibility with Serverpod
4.0.3. The [runbook](RUNBOOK.md) describes the required validation; the
[submission checklist](SUBMISSION.md) records the remaining work.

## Legal information, not legal advice

- The corpus contains 25 hand-transcribed provisions. Retrieval is lexical,
  not semantic; unfamiliar phrasing may miss relevant provisions.
- Sources link to the India Code root rather than verified per-act pages.
  Wording and applicability require independent checking, even for entries
  without a verification warning. State-specific rules may be absent.
- Structured citations come from corpus rows. Model-generated prose may still
  contain mistakes, unsupported claims, or inappropriate next steps.
- Risk and completeness scores are heuristics, not calibrated legal judgments.
  Urgency and safety classification can miss danger. Do not wait for this app
  in an emergency; contact appropriate local emergency services.

## Data and access

- There is no login. A `Random.secure()` case reference acts as a bearer secret.
  Anyone with that reference can access the file. This is a demo-level trade-off,
  not strong access control for a public legal service.
- Original descriptions and answers are stored in PostgreSQL. The reference is
  stored in browser localStorage. “Start a new file” forgets the local reference;
  it does **not** delete the server-side case.
- Live mode sends redacted context to Google. Regex redaction covers selected
  identifier formats but can miss names, addresses, unusual formats, and other
  identifying facts. Do not enter sensitive real-case information in this demo.
- There is no user-facing deletion, retention policy enforcement, encryption of
  individual case fields, or production security review.
- In-memory per-case model limits are not global abuse protection. Restarting
  resets them; opening additional cases can bypass them. Do not expose the
  unauthenticated demo publicly with a billable key without additional controls.

## Offline and live model behavior

- Fixtures are hand-written and use a workplace example. They are not recordings
  and do not adapt to unrelated narratives. Sample mode demonstrates the intended
  plumbing, not personalized legal guidance.
- Gemini access, quotas, and grounding/schema compatibility are unverified.
  The provider retries a rejected search-tool request without search and records
  a degradation note; corpus retrieval remains separate from web search.
- There is no claim of a successful live response or deployed service.

## Reliability and scope

- Two English-language web screens only. Native platforms are not supported by
  the browser-specific helpers.
- The PDF is a one-page, ASCII-oriented brief. Long content is visibly truncated;
  it is not a complete export of every field or a filing-ready legal document.
- Questions are bounded per response, not a guarantee of only three across all
  revisions. Refresh restores stored case/plan data; pending questions require
  re-triage because they are not persisted as a question list.
- Concurrent requests, crashes during model generation, stale plans after intake
  edits, and reconnect recovery need integration testing. The queue is not a
  verified exactly-once processing system.
- The unit tests cover selected guards, not end-to-end behavior. No integration
  test or analysis pass has been reported.
