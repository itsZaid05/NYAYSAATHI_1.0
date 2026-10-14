# NyaySaathi

### A clearer first step when you do not know where to turn.

NyaySaathi helps someone in India describe a legal problem in plain English,
answer clarifying questions, and prepare a practical action plan to discuss with
a legal-aid professional. Built around **Serverpod 4.0.3**, **Flutter**, and
server-side **Gemini**, with an explicit no-key sample mode.

**Describe → clarify → triage → plan → inspect sources → download a brief**

> **Build status:** this repository contains the recovered application sources
> and setup scripts. Generated Serverpod packages and database migrations are
> not yet checked in. Dart/Flutter compilation, tests, and the end-to-end flow
> have not been verified. Follow the [runbook](docs/RUNBOOK.md); do not treat
> source review as a successful build.

## One problem, two screens

- **Intake:** describe what happened, answer up to three questions per triage
  response, and review the category, urgency, missing evidence, and risk factors.
- **Action plan:** follow background-generation stages, read numbered steps,
  inspect statute-index citations, copy a draft, and download a server-built PDF.
- **Resume:** the browser stores a random case reference; the server stores the
  case and plan. No account is required. Treat that reference like a password.

This is **legal information, not legal advice**. It does not establish a
lawyer–client relationship, promise an outcome, or replace emergency services.
Do not enter real sensitive case details in an unverified demo deployment.

## What Serverpod owns

| Responsibility | Implementation |
| --- | --- |
| API and typed client contract | Intake, advice, and corpus endpoints; `.spy.yaml` models |
| Persistence | PostgreSQL case, intake-turn, provision, and advice tables |
| Background work | `AdviceFutureCall` builds the plan outside the request |
| Live progress | `AdviceProgress` messages on `case_<reference>` via a stream endpoint |
| Model boundary | Server-side API key, prompt construction, redaction, payload checks |
| Export | PDF assembled on the server from stored case and advice data |

### How an answer is grounded

1. Search a small, seeded statute index using lexical and domain scoring.
2. Send retrieved provisions and redacted case context to Gemini with a JSON schema.
3. Validate the response and rebuild the **structured citation list** from retrieved
   database rows, rather than accepting model-written source names and URLs.
4. Store the result and publish progress to the client.

This constrains the citation list, **not every claim in the prose**. The 25-entry
corpus is hand-transcribed and not comprehensively verified; its verification flags
are visible in the UI. Risk scoring is a deterministic heuristic, not a legal assessment.

## Run locally

Requirements: Flutter **3.44.4** / Dart **3.12.2**, Serverpod CLI **4.0.3**,
Python 3.10+, and the database/container prerequisites required by your local
Serverpod installation. The complete sequence, including project generation,
migrations, offline mode, and live mode, is in the **[runbook](docs/RUNBOOK.md)**.

```bash
git clone --branch arena/7eece4c1-nyaysaathi-1-0 https://github.com/itsZaid05/NYAYSAATHI_1.0.git ~/nyaysaathi
```

Start with `NYAY_OFFLINE=1`. No Gemini account or key is needed for sample mode.
Its answers are **hand-written fixtures**, not personalized legal guidance and
not recordings of live responses. Live mode requires your own Google AI Studio
key; availability, quotas, and pricing depend on that service.

Never commit a key. Set `GEMINI_API_KEY` in the **server's environment**, or use
its ignored `config/passwords.yaml`. Never pass it through Flutter build flags.

## Repository map

```text
overlay/
  server/     Models, endpoints, services, corpus, future calls, unit tests, config
  flutter/    Intake and plan screens, client setup, browser helpers, shared widgets
scripts/      Bootstrap, overlay application, source audit
docs/         Runbook, limitations, AI-use disclosure, submission text
```

After the runbook's project-import step, `nyay_server/`, `nyay_client/`, and
`nyay_flutter/` belong at this repository's root. Keep `overlay/` alongside them
and synchronize fixes before reapplying it. The earlier static JS prototype and
recovery bundle have been removed from the current tree; the previous Git commits
retain the recovery artifact.

## Verification and submission

- [Build and run instructions](docs/RUNBOOK.md)
- [Known limitations and privacy boundaries](docs/LIMITATIONS.md)
- [AI-use disclosure](docs/AI_USE.md)
- [Submission description and outstanding checklist](docs/SUBMISSION.md)

The demo video URL and runtime evidence still need to be supplied. There is no
hosted deployment claimed by this repository.
