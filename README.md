# NyaySaathi — a legal first-response kit on Serverpod 4

Describe a legal problem in your own words. The server asks up to three
clarifying questions, sorts the case, looks up the provisions that apply in its
own statute index, and writes a numbered plan you can act on — every citation
traceable, and a one-page PDF to take to a legal-aid clinic.

Built for **Build Something Real: The Serverpod Hackathon** (15 Sep → 14 Oct 2026).
One user, one problem, one flow. No dashboard, no marketplace, no filler pages.

## What is where

```
nyay_server/lib/src/models/        18 .spy.yaml: case, turns, provisions, plan, progress
nyay_server/lib/src/endpoints/     intake · advice · corpus
nyay_server/lib/src/services/      engine, corpus retrieval, model provider, guards, pdf
nyay_server/lib/src/future_calls/  AdviceFutureCall — the plan runs off the request
nyay_server/lib/src/corpus/        recorded fixture answers for offline runs
nyay_server/test/unit/             the guards, tested without a database
nyay_flutter/lib/                  two screens, one client, five shared widgets
overlay/ scripts/ docs/            what was written for this repo, and how to run it
```

## Serverpod, doing the work

| Feature | Where it is used |
| --- | --- |
| Endpoints + generated client | `intake.open/answer/progress/transcript`, `advice.queue/retry/latest/watch/exportPdf`, `corpus.search/count/seed` |
| Models, Postgres, migrations | 18 model files; every screen reads rows, none reads the model |
| Server messages (realtime) | `case_<reference>` carries `AdviceProgress`; `watch()` is a `Stream` endpoint method |
| Future calls | the plan is built by `AdviceFutureCall`, survives a restart, retried by the framework |
| Passwords in config | `config/passwords.yaml` holds the Gemini key; the client never sees it |
| Caching/logging/insights | default config; `session.log` on every failure path |

## Why the AI part is not decoration

`GeminiProvider` is the only thing that talks to a model —
`v1beta/models/gemini-2.5-flash:generateContent`, `responseMimeType: application/json`
plus an explicit `responseSchema`, with `google_search` grounding requested
alongside. Then:

1. **Redaction first.** `redactPii` strips phone, email, Aadhaar, PAN, account
   numbers, vehicle plates and dates of birth before anything leaves the server,
   leaving readable tokens (`[PHONE]`) so the model still understands the shape.
2. **Retrieval decides what may be cited.** `CorpusService` scores 25
   hand-transcribed provisions (keyword overlap, keyword list, domain, procedure
   match), keeps the top 6 above a threshold, and passes *their* text to the
   model with one instruction: cite only from this list, by index, or say the law
   is unclear.
3. **Validation before storage.** Every field goes through `Payload`, which
   enforces lengths, list sizes, ranges and enum membership. An answer that does
   not fit is a failure, not a partial row.
4. **Citations are rebuilt, not copied.** `Advice.authorities` is constructed
   from the retrieved corpus rows by index — so an invented section number has no
   path to the screen. Provisions carry `needsVerification`, and the UI shows it.
5. **Risk is arithmetic.** `assessRisk` scores safety, urgency, deadline, thin
   evidence, missing documents and domain confidence. Same facts, same number.
6. **Failures are loud and lose nothing.** `status = failed`, the reason stored,
   the previous plan untouched, `AdviceUnavailableException` to the client, and a
   retry button that re-arms the same row.

No key or `NYAY_OFFLINE=1` → the same engine runs on recorded fixture answers and
the plan panel says so in an amber banner. It exists so a reviewer with no quota
sees the real code path, not to make the app look smarter.

## Run it

```bash
./scripts/bootstrap.sh ../play        # creates the Serverpod project + applies this code
```

or the long way in [`docs/RUNBOOK.md`](docs/RUNBOOK.md). Then:

```bash
cd play/nyay/nyay_server && serverpod generate
cd play/nyay && serverpod start       # press M, apply the migration, then R
export GEMINI_API_KEY=...             # optional; skip to run on fixtures
cd play/nyay/nyay_flutter && flutter run -d chrome
```

Tests and analysis:

```bash
cd play/nyay/nyay_server
dart analyze --fatal-infos
dart test test/unit
python3 ../../scripts/audit.py         # model YAML + call-shape consistency check
```

## Read these before trusting a claim

- [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) — including that **no auth** is in
  this build, and what replaces it.
- [`docs/AI_USE.md`](docs/AI_USE.md) — required disclosure: what the agent wrote,
  what a human ran.
- [`docs/SUBMISSION.md`](docs/SUBMISSION.md) — the entry text.

## What this app will not do

It will not name a lawyer, predict an outcome, or tell you what a court will
decide. Anything that looks dangerous escalates to 112 (or 181) before it
suggests paperwork. It is legal information, and it says so on the screen that
shows the answer.
