# NyaySaathi — submission

## Links

- **Repository:** https://github.com/itsZaid05/NYAYSAATHI_1.0
- **Submission branch:** https://github.com/itsZaid05/NYAYSAATHI_1.0/tree/arena/7eece4c1-nyaysaathi-1-0
- **Build and run:** [RUNBOOK.md](RUNBOOK.md)
- **AI-use disclosure:** [AI_USE.md](AI_USE.md)
- **Demo video:** pending URL from the author. The author reports that a video
  has been recorded; its contents, availability, and duration have not been checked.

Use the branch URL until these changes are merged; the default branch may still
show the old prototype. Do not claim the repository has been shared with judges
until access has been checked.

## Description

NyaySaathi is a legal first-response tool for people in India who need a clearer
next step. A person describes their problem in plain English, answers clarifying
questions, and receives a triage summary and a numbered plan with evidence to
collect, possible next contacts, and citations from a small statute index. A
server-built PDF is intended to help the person take that information to a
legal-aid professional.

The implementation is deliberately focused: one intake screen and one plan
screen, with no dashboard, marketplace, or login. Serverpod owns the typed API,
PostgreSQL persistence, background advice generation, progress messages, and PDF
export. Flutter displays the server's results. A random case reference provides
access to the file; anyone holding it can read that case.

Gemini runs only on the server. Prompts use JSON response schemas and
pattern-based PII redaction. The structured citation list is rebuilt from
retrieved statute rows, not from model-written source names. This reduces one
kind of invented citation; it does not guarantee correct prose or legal advice.
The corpus is small and hand-transcribed, and verification warnings are part of
the interface.

No paid model account is needed to exercise the intended offline path: explicitly
labelled, hand-written fixtures run through the same engine. They demonstrate
application plumbing, not case-specific legal reasoning. Live mode requires the
reviewer's own Google AI Studio key and access to the service.

## Current verification status

Application source recovery and submission cleanup are complete. **The generated
project, migration, Dart/Flutter analysis, tests, and runtime flow are not yet
verified.** No working deployment or successful live Gemini run is claimed.
Read [LIMITATIONS.md](LIMITATIONS.md) before evaluating the build.

## Before pressing Submit

- [ ] Generate the Serverpod project and resolve all generation/compile errors.
- [ ] Import the generated packages and migration into this repository root.
- [ ] Run the complete offline flow, including PDF download and refresh.
- [ ] Run the live Gemini flow; disclose any remaining failures.
- [ ] Replace fixtures with sanitized live recordings only after obtaining them;
      until then retain the hand-written-sample disclosure.
- [ ] Run analysis, unit tests, source audit, and formatting from the runbook.
- [ ] Push the final code and verify the submitted branch URL opens for reviewers.
- [ ] Add the video URL; verify it is accessible and under two minutes.
- [ ] Confirm repository access for viktor@serverpod.dev,
      alexander@serverpod.dev, and isak@serverpod.dev as required by the event.
- [ ] Check the organizer's submission portal and deadline; no entry has been
      submitted by this coding session.

## AI disclosure (short form)

An Arena.ai agent produced and reviewed application code, tests, setup scripts,
and documentation. The author chose the product scope and is responsible for
running and validating the toolchain. No unreported human or automated test run
is assumed. Full disclosure: [AI_USE.md](AI_USE.md).
