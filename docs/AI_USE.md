# AI-use disclosure

## Agent contribution

An Arena.ai agent produced the recovered Serverpod and Flutter implementation,
model schemas, prompts, hand-written fixtures, corpus transcription, guard tests,
PDF writer, setup scripts, and initial documentation. A subsequent agent session
recovered those files from a Git bundle, reviewed the sources, removed the old
static prototype, corrected source-level defects, and revised the documentation.

Agent-assisted source review is not compilation, a legal review, or runtime
verification. In particular, claims in earlier drafts that all commands had
already been run by a human were unsupported and have been removed.

## Author contribution and verification

The author selected the problem, product scope, two-screen flow, and no-login
case-reference design. The author reports having recorded a demo video; a link
has not yet been supplied in this session. The author runs the Flutter, Dart,
Serverpod, and database toolchain. No successful toolchain output has been
provided during this recovery and cleanup session.

The agent ran Python setup-script tests, a heuristic source audit, and shell/diff
checks during cleanup. These are recorded in [VERIFICATION.md](VERIFICATION.md)
and do not establish Dart/Flutter runtime behavior. Update the submission checklist
with actual results, not anticipated results.

## AI inside the product

Live mode uses `gemini-2.5-flash` through a server-side provider for triage,
questions, and plan prose. Prompts request structured JSON; the engine performs
retrieval, response validation, deterministic risk scoring, and structured
citation reconstruction. Regex-based redaction is a best-effort privacy measure,
not complete anonymization.

Offline mode uses **hand-written JSON samples**, not recordings from live Gemini
responses. They must remain labelled as samples unless replaced with genuinely
recorded and sanitized outputs. No real legal cases or API credentials should be
included in recordings or source control.

## Recovery history

The author reported a sandbox reset that destroyed a separate submission folder.
Five commits were preserved in a bundle in this repository, ending at `e1205ca`.
Their source tree was recovered onto the current Arena branch. The current tree
no longer carries the old JS prototype or bundle; earlier Git commits preserve
those artifacts. No claim is made that the entire repository history originated
within a particular eligibility window.
