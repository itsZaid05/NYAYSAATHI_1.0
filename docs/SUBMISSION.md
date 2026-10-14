# Entry text — paste-ready

**Repository.** https://github.com/itsZaid05/nyay-saathi — shared with
viktor@serverpod.dev, alexander@serverpod.dev and isak@serverpod.dev. Two commits,
both inside the window: the hand-written overlay and documentation, then the
generated project with the migration and the fixes needed to run it. No history was
carried over from anything older.

**What it is.** NyaySaathi is a first-response kit for someone in India with a legal
problem and no lawyer. You describe it in your own words; the server asks at most
three clarifying questions, sorts the case, retrieves the provisions that apply from
its own statute index, and writes a numbered plan — who it goes to, where, by when,
what to bring — with every citation traceable back to the index and a one-page PDF to
take to a legal-aid clinic. It refuses to name a lawyer or promise an outcome, and
anything that looks unsafe is escalated to 112 before any paperwork.

**Why it is built this way rather than prompt-first.** The model may only cite what
retrieval returned, its answer is decoded through hard field limits and an explicit
JSON response schema, and the citation list is rebuilt from the database rows instead
of from the model's prose — so an invented section number has no path to the screen.
PII (phone, email, Aadhaar, PAN, account and plate numbers, dates of birth) is
stripped before anything reaches the API. Risk is deterministic arithmetic over stored
facts, not model opinion. Any failure stores a reason and changes nothing: the
previous plan stays visible, and there is a retry button.

**How Serverpod is doing the work.** 18 model files and a real Postgres migration;
three endpoints with a generated Dart client the UI calls directly; server messages on
`case_<reference>` feeding the stage chips in the plan screen; a future call that
builds the plan off the request path and survives a restart; `config/passwords.yaml`
holding the only API key in the system; `session.log` on every failure path; the
server writing the PDF from stored rows. Nothing about the flow is a client-side mock:
refresh the page and the case is still there because it is a row, and the plan is
still there because it was validated before it was saved.

**Try it.** `docs/RUNBOOK.md` is the exact sequence; the short version is
`./scripts/bootstrap.sh ../play`, `serverpod generate`, `serverpod start` (press **M**
to migrate, then **R**), then `flutter run -d chrome` in `nyay_flutter`. No test
account is needed and there is nothing to pay for — the case reference is the
credential, and the app runs without an API key on recorded fixtures with a visible
banner, so a reviewer with no quota still exercises the same code path. With a Google
AI Studio key in `nyay_server/config/passwords.yaml` (or `GEMINI_API_KEY`) the same
buttons call `gemini-2.5-flash` with search grounding.

**What was cut, and said out loud.** Authentication, integration tests and CI were
dropped in the last hours to protect the one flow that matters — `docs/LIMITATIONS.md`
states what replaces auth (a `Random.secure()` reference, never the row id) and what
has not been compiled. That document is part of the submission on purpose.

**Video.** `[link]` — under two minutes, Chrome against a local Serverpod 4.0.3 +
Postgres, covering intake → questions → live plan → citations → PDF → refresh.

**AI use.** Disclosed in `docs/AI_USE.md`: an agent wrote the implementation against
4.0.3's published source and docs; a human ran every toolchain command, made the scope
decisions, and edited the copy. A larger first draft was lost to a sandbox reset
before it was pushed; the rebuild is the second commit's message.
