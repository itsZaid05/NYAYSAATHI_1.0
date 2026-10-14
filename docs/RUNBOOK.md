# RUNBOOK — do these, in this order

Every command is one line. Nothing here has been run by the person who wrote the
code (that sandbox had no Dart or Postgres), so treat the first compile error as
expected and fix it — the message will name the file. Times assume you start from
nothing and have about two hours.

## 0. What you need installed

```bash
flutter --version
dart --version
```

You need Flutter **3.44.4 or newer** (which brings Dart 3.12.2). If `flutter` is not
found, install the SDK and add `<flutter>/bin` to your PATH. Postgres is **not**
needed: `serverpod start` starts its own.

```bash
dart pub global activate serverpod_cli 4.0.3
export PATH="$PATH:$HOME/.pub-cache/bin"
serverpod --version
```

If the last line prints `4.0.3`, you are ready.

## 1. Clone this repository

```bash
cd ~
git clone https://github.com/itsZaid05/nyay-saathi.git
cd nyay-saathi
```

## 2. Create the Serverpod project and apply this code onto it

```bash
mkdir -p ~/play && cd ~/play
serverpod create nyay --template fullstack --database --webapp --ide none
```

Answer the prompts: **PostgreSQL**, database name **nyay**, role **postgres**, leave
the port empty, and when it offers to run the server choose **no** (or press `Ctrl-C`
when it starts). Then:

```bash
python3 ~/nyay-saathi/scripts/apply_overlay.py ~/play/nyay
```

It prints each file it writes, ends with `N files written.`, and tells you the next
three commands. If it says `no nyay_server`, you are in the wrong folder — the path you
pass must *contain* `nyay_server/`.

## 3. Generate the Dart code from the models

```bash
cd ~/play/nyay/nyay_server
serverpod generate
```

You should see it write `lib/src/generated/protocol.dart`, `endpoints.dart`,
`serverpod.dart` and `nyay_client/lib/src/protocol.dart`. **If it errors, stop and fix
that error** — it will name the `.spy.yaml` file and the field. Every later step
depends on this one.

## 4. Start it, create the database schema

```bash
cd ~/play/nyay
serverpod start
```

The menu appears. Press **M** (migrations), wait for it to print the diff — it should
list `legal_case`, `intake_turn`, `legal_provision`, `advice` — approve, then press
**R** to restart. You want to see in the log:

```
Seeded 25 provisions into the statute index     (wording may differ)
```

That is the corpus. Without it nothing can be cited.

## 5. The model key (optional but this is the product)

Get a key from Google AI Studio, then either:

```bash
export GEMINI_API_KEY=AIza...            # same terminal, before step 6
```

or edit `~/play/nyay/nyay_server/config/passwords.yaml` (already git-ignored) and put
the key on the `geminiApiKey:` line under `development:`, then restart with **R**.

Skip it entirely and the app runs on recorded fixtures, with a banner that says so —
useful for the 10 seconds of the demo where the network is not the story.

## 6. Run the web app

```bash
cd ~/play/nyay/nyay_flutter
flutter run -d chrome
```

If it says no web device: `flutter config --enable-web && flutter devices`.

## 7. Click through it once, fully

1. Type at least 40 characters about a real kind of problem (the example in the hint
   text works). Press **Sort this out**.
2. You should get a triage card: area, urgency, a risk badge, "why the risk is what it
   is", "still needed", and up to three questions. Check the browser's Network tab: one
   `intake.open` call.
3. Answer a question. The card re-runs. Skip is allowed.
4. Press **Write my plan**. The plan screen shows stage chips moving — Retrieving →
   Writing → Validating → Saving → Ready — while the request has already returned.
5. Read the bottom of the plan: **What this rests on** must list provisions with a
   code, a quote, the India Code URL and, where applicable, "Wording not yet checked".
   If it says "no provision was cited", that is the app being honest, not broken.
6. Press the download icon. A one-page PDF opens in your downloads with the same text
   and the model/prompt line in the footer.
7. Refresh the page. It reopens on the same case, because the reference is in
   localStorage and the plan is a row.

Anything that does not survive step 7 is a bug worth fixing before you record.

## 8. Tests and analysis

```bash
cd ~/play/nyay/nyay_server
dart analyze --fatal-infos
dart test test/unit
```

`dart test` should print ~14 passing tests. If `dart analyze` reports unused
imports or `directives_ordering`, `dart format .` fixes the formatting ones.

## 9. Put the working project into the repository, then record

The clone holds the hand-written source; the project in `~/play/nyay` is what actually
runs. Bring the generated packages back so the repository can be cloned and run by
someone else:

```bash
rsync -a --exclude '.git' --exclude '.dart_tool' --exclude 'build' \
  ~/play/nyay/ ~/nyay-saathi/
cd ~/nyay-saathi
ls                     # want: nyay_server  nyay_flutter  nyay_client  overlay  scripts  docs
git status --short | head -20
```

`config/passwords.yaml` must **not** appear in that list — `.gitignore` keeps it out.
Commit before recording, so the video and the code are the same run.

Two minutes maximum, running on Chrome against the local server. Storyboard:
sign-in-free start → type the narrative → the questions → the triage card → **watch
the chips move** while it writes → the citations → the PDF download → refresh to show
it persisted. End on the reference number, so the run is verifiable.

```bash
cd ~/nyay-saathi
git add -A && git commit -m "Generated Serverpod project, migration, first working run"
git push
```

Commit **from the clone** after step 3–7 so the second commit carries your real fixes.

## If something fails

| What you see | What it means / do this |
| --- | --- |
| `serverpod create` rejects `--ide none` | drop that flag; the rest of the command is unchanged |
| `serverpod generate` fails on a `.spy.yaml` | it names the field. The two things most likely to be off are `default=` on an enum field and `relation(parent=legal_case)`; fix the YAML and re-run |
| `Undefined name 'Session'` anywhere in `lib/src/services/` | add `import 'package:serverpod/serverpod.dart';` to that file |
| `getPassword` not found on `Serverpod` | your minor version moved it to `pod.passwords.get(key)`; one call site, `services/config.dart` |
| `postMessage` / `createStream` type error | `AdviceProgress` must stay a Serverpod model (it is) and `channel` must be the same string on both sides: `case_` + reference |
| Flutter: `Target of URI doesn't exist: 'package:nyay_client/nyay_client.dart'` | you skipped step 3, or you ran `flutter run` from the wrong folder |
| `client.intake` has no member `open` | the endpoint file is not in `nyay_server/lib/src/endpoints/` |
| The plan never leaves "Queued" | the future call needs the restart: press **R** in the Serverpod menu; then check the log for `AdviceFutureCall` |
| Every screen shows the amber fixture banner | no key was picked up — check step 5, or accept it for the offline demo |
| `dart test test/unit` fails on `Urgency` | run `serverpod generate` first; the tests import generated code |
