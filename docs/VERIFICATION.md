# Verification record

This separates checks performed in the coding workspace from checks that still
require the author's toolchain. A passing source audit is not a working app.

## Completed in the cleanup session

| Check | Result |
| --- | --- |
| Recovery | Located all five bundled commits; recovered source from `e1205ca` |
| Setup-script tests | `python3 -m unittest discover -s scripts/tests -v`: 6 passed |
| Source audit | `.venv/bin/python scripts/audit.py`: 18 models/enums, 24 Dart files, audit clean |
| Shell syntax | `bash -n scripts/bootstrap.sh`: passed |
| Patch whitespace | `git diff --check`: passed |
| Remote backup | Cleanup batches committed and pushed to `arena/7eece4c1-nyaysaathi-1-0` |

The setup tests use temporary miniature directory structures. They check
credential/config preservation, dependency insertion, repeat application,
preflight failure, and removal of known template demos. They do not generate or
compile a Serverpod project.

Source review also checked selected APIs and schema examples against the
Serverpod repository's `4.0.3` tag. That informed fixes; it is not an API
compatibility certification.

## Not run / not verified

- Serverpod project creation and `serverpod generate`.
- PostgreSQL startup, migrations, and corpus seeding.
- Dart/Flutter analysis or formatting.
- Dart unit tests and Flutter widget tests, including the newly added regressions.
- Offline and live end-to-end flows, PDF rendering in a viewer, refresh, retries,
  or restart/concurrent-request behavior.
- Demo video duration/content, judge access, public deployment, or portal submission.

The author runs these next, one command at a time, using [RUNBOOK.md](RUNBOOK.md).
Record the command, output, and observed behavior here before changing build-status
claims in the README or submission description.
