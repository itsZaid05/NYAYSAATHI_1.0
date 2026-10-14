# Limitations, stated before anyone finds them

* **Nothing here has been compiled.** The code was written in a sandbox with no
  Dart, Flutter, Serverpod CLI or Postgres. `serverpod generate` and the first
  `flutter run` are the moment of truth; `docs/RUNBOOK.md` ends with the fixes
  most likely to be needed.
* **No authentication in this build.** Four hours before the deadline is not the
  time to debug `SignInWidget`, so the anonymous-provider wiring was cut rather
  than faked. What replaces it: a case is addressed by a 13-character random
  reference (`NYAY-XXXX-XXXX`) generated with `Random.secure()`, never by its row
  id, and the numeric id is not accepted by any endpoint. Anyone holding the
  reference can read that file — which is a deliberate capability-URL trade-off,
  not an oversight. The `userId` column and `requireLogin` are the first thing to
  add back.
* **Retrieval is lexical.** Keyword and domain scoring over 25 provisions, not
  embeddings. It is real and it is what makes the citation filter possible, but a
  case phrased in unusual words can find nothing — and the app then says the law
  is unclear rather than inventing something.
* **The corpus is transcribed, not fetched.** 25 provisions, written by hand from
  the official India Code text. `sourceUrl` is the India Code root for every row
  because deep per-act links could not be verified from where this was written;
  the alternative was plausible-looking URLs that might be wrong. Rows that state
  a number or a period are marked `needsVerification`, which the plan screen
  shows verbatim.
* **One page of PDF, one language.** `PdfBuilder` writes its own text objects
  (no dependency, xref offsets verified by test) and truncates with a visible note
  rather than spilling. English only.
* **Fixtures are hand-written.** They are shaped like real answers and used only
  when no key is present, but they were not recorded from a live call yet. Until
  they are, the offline path proves the plumbing, not the prose.
* **The model can still be wrong.** Grounding, schema validation and citation
  filtering bound the damage; they do not remove it. That is why the wording, the
  prompt version and the search queries are on the screen next to the answer.
