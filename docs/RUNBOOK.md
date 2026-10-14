# Build and run

These commands target **Flutter 3.44.4 / Dart 3.12.2** and **Serverpod CLI
4.0.3**. They are instructions, not a record of a successful run. Stop at the
first error and resolve it before proceeding. Do not paste API keys into logs,
issues, or chat.

Commands assume a Unix-like shell and this checkout at `~/nyaysaathi`. If you
already have the repository elsewhere, substitute that path consistently.
Run one command at a time when working with the coding agent and share its output.

## 1. Clone the submission branch

```bash
git clone --branch arena/7eece4c1-nyaysaathi-1-0 https://github.com/itsZaid05/NYAYSAATHI_1.0.git ~/nyaysaathi
```

The root should contain `overlay/`, `scripts/`, and `docs/`. If generated
`nyay_server/`, `nyay_client/`, and `nyay_flutter/` packages are already present,
skip project creation and overlay application; run from this root instead of
`~/nyay-build/nyay` below.

## 2. Check tools

```bash
flutter --version
```

```bash
dart --version
```

```bash
dart pub global activate serverpod_cli 4.0.3
```

```bash
export PATH="$PATH:$HOME/.pub-cache/bin"
```

```bash
serverpod --version
```

Expect CLI version 4.0.3. Have Chrome and the database/container prerequisites
required by your Serverpod installation available. Verify startup rather than
assuming PostgreSQL is already running.

## 3. Generate a fresh project

```bash
mkdir -p ~/nyay-build
```

```bash
cd ~/nyay-build
```

```bash
serverpod create nyay --template fullstack --database --webapp --ide none
```

Expected: a `nyay/` directory containing the server, client, and Flutter packages.
Follow the CLI's database prompts and stop before running the app. If `--ide none`
is rejected, remove only that flag and retry. Do not create a project over an
existing one with local changes.

Apply the application sources:

```bash
python3 ~/nyaysaathi/scripts/apply_overlay.py ~/nyay-build/nyay
```

Expected: a list of copied files and `N files written.` The script preserves an
existing `config/passwords.yaml`; edit database credentials there to match your
local setup. Reapplying the overlay overwrites application source files—copy any
fixes back to `overlay/` first. The optional `scripts/bootstrap.sh` automates this
creation/application step, but is not a substitute for checking its output.

## 4. Generate protocol and client code

```bash
cd ~/nyay-build/nyay/nyay_server
```

```bash
serverpod generate
```

Expected: generated server protocol, endpoint dispatch, server setup, and
`nyay_client` code. If it fails, retain the complete error and fix the named model
or endpoint before continuing. Do not hand-write generated protocol files.

Known 4.0.3 call shapes used by this source: `withSession(callback)`;
`Serverpod(args)` imported from generated server setup; integer model relations;
future-call sites without a session argument; awaited `postMessage`;
`getServerUrl` and `FlutterConnectivityMonitor` from `serverpod_flutter`.

## 5. Start offline and migrate

In the server terminal, **before** starting the server:

```bash
export NYAY_OFFLINE=1
```

```bash
cd ~/nyay-build/nyay
```

```bash
serverpod start
```

Use **M** to create/apply the migration when offered and **R** to restart.
Check the migration includes `legal_case`, `intake_turn`, `legal_provision`, and
`advice`. Keep the generated migration in version control. Confirm a log such as
`seeded 25 provisions into the statute index`. If startup fails before migration,
resolve the schema/database setup using the CLI's error output, then restart.

In a second terminal:

```bash
cd ~/nyay-build/nyay/nyay_flutter
```

```bash
flutter run -d chrome
```

Check the generated app's server URL configuration. The browser must be able to
reach the API. For a remote deployment, use a reachable HTTPS API URL; a browser's
`localhost` is not a remote development machine.

## 6. Verify the complete offline flow

Use a fictional workplace example, since that is what the hand-written fixtures
represent. Do not use sensitive real-case details.

1. Enter at least 40 characters, then select **Sort this out**.
2. Check the summary, risk factors, missing evidence, questions, and sample label.
3. Answer a question; verify triage updates on the same reference.
4. Select **Write my plan**. Check progress stages and the saved plan.
5. Inspect citations and verification warnings. A missing source must not be
   presented as a verified legal basis.
6. Download the PDF and open it. Check the reference, sample notice, and any
   truncation warning.
7. Refresh; verify the same case and saved plan return without another model call.
8. Edit the description and re-triage. Check that a regenerated plan reflects the
   updated case, rather than silently showing an obsolete one.
9. Stop/restart the server and test failed-request retry and stream reconnection.

Record actual failures in `LIMITATIONS.md`. A sample plan appearing is not
proof that the live model works.

## 7. Test live mode

Stop the server, unset the override in the same terminal, and configure the key
privately in `nyay_server/config/passwords.yaml` under `development.geminiApiKey`
or in the server environment. The key must not be a Flutter build variable.

```bash
unset NYAY_OFFLINE
```

Restart with `serverpod start`, repeat the flow, and check the model notice names
`gemini-2.5-flash`. If both environment and password keys are absent, sample mode
is expected. No silent fallback to samples should disguise a failed live request.

Only replace `fixture_answers.dart` after obtaining and sanitizing real responses.
Document their model, prompt version, and collection method without saving keys
or personal case data. Until then retain the hand-written-fixture disclosure.

## 8. Analyze and test

In `nyay_server/`:

```bash
dart analyze --fatal-infos
```

```bash
dart test test/unit
```

In `nyay_client/`, run `dart analyze --fatal-infos`. In `nyay_flutter/`, run
`flutter analyze --fatal-infos` and `flutter test`. Resolve every error; formatting alone does not
fix missing imports, unused variables, or API incompatibilities.

From `~/nyaysaathi`, install the audit dependency in a virtual environment:

```bash
python3 -m venv .venv
```

```bash
.venv/bin/python -m pip install -r scripts/requirements-dev.txt
```

```bash
.venv/bin/python scripts/audit.py
```

The source audit is heuristic, not a Dart compiler or compatibility test.
Run the setup-script tests with:

```bash
python3 -m unittest discover -s scripts/tests -v
```

Run `dart format .` in each generated package and on both overlay `lib/` trees
and the overlay unit tests. Copy any source fixes between the generated packages
and `overlay/` deliberately; do not overwrite one with stale files.

## 9. Bring the verified project into this repository

Preview the copy first:

```bash
rsync -an --exclude '.git' --exclude '/README.md' --exclude '/.gitignore' --exclude '/docs' --exclude '/scripts' --exclude '/overlay' --exclude '.dart_tool' --exclude 'build' --exclude '.serverpod' --exclude '.env*' --exclude 'passwords.yaml' --exclude '.flutter-plugins*' --exclude 'ephemeral' --exclude 'Pods' --exclude '.symlinks' ~/nyay-build/nyay/ ~/nyaysaathi/
```

Review that output, then repeat with `-a` instead of `-an`. Keep `overlay/`,
`scripts/`, `docs/`, this README, and the repository's ignore rules; the overlay
script does not copy those into the build directory. Do not use `--delete`.
Never copy database volumes, credentials, local recordings, or build artifacts.

Review `git status --short` and the staged diff before committing. Ensure ignored
`config/passwords.yaml` files are not tracked. Push only the assigned branch:

```bash
git push origin arena/7eece4c1-nyaysaathi-1-0
```

Finally, do a fresh-clone run from the submitted branch, complete
[SUBMISSION.md](SUBMISSION.md), and supply the video URL. Do not mark verification
items complete without the corresponding output or manual observation.
