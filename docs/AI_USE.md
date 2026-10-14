# AI / agentic use — disclosure

Required by the rules, so here it is without hedging.

**An agent wrote this.** An Arena.ai agent session produced the Serverpod source
(models, endpoints, the engine, the corpus file, the PDF writer, the guards, the
tests), the Flutter app, the overlay script and these documents. It also did the
API research — reading Serverpod 4.0.3's own files (`templates/serverpod_templates/**`,
`examples/auth/**`, `packages/serverpod/lib/src/server/serverpod.dart`, the future-call
and session code) and the 4.0 documentation, and checking each call site against what
it read. The gotchas it found that way are in the code comments: `withSession` takes
only a callback; `copyWith` treats a null argument as "keep", so rows are assigned and
written with `updateRow`; a future call's session is supplied by the framework, so the
call site passes no session; generated models have no const constructor.

**A human ran everything that could be run.** Flutter, Dart, the Serverpod CLI,
Postgres, `serverpod generate`, the migration, the tests, the manual pass through the
four screens, and the demo recording. The scope decisions were the human's: which
product, which one flow, and the call to cut authentication when the clock ran down.

**What was lost and rewritten.** A first, larger version of this overlay (22 models,
auth, integration tests, CI) existed only inside the sandbox and was destroyed when the
sandbox was reset before it could be pushed. The rebuild is smaller and the diff in
`git log` shows it as one commit with its reasoning. Nothing is being presented as
pre-window work: every commit here is inside the window.

**Where AI use is treated as a limitation.** The writing environment had no
toolchain, so this code has never met a compiler. Anything unverifiable was avoided
rather than guessed at (no `Vector` column at runtime, no invented per-act URLs), and
the rest is listed in `docs/LIMITATIONS.md`. No document in this repo claims "tested"
unless a person ran it.

**The product discloses its own AI use to its user.** `ModelNotice` names the model
and prompt version on the plan, or states plainly that the model is not answering; the
citations, their scores, the search queries the model was allowed to run and the
verification flags are all on screen. The app never claims to be a lawyer.
