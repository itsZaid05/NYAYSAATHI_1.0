#!/usr/bin/env python3
"""Put the NyaySaathi sources onto a freshly created Serverpod project.

Run it from inside the generated project (the folder `serverpod create nyay` made):

    python3 /path/to/repo/scripts/apply_overlay.py .

It copies overlay/server/{lib,config,test} into nyay_server and overlay/flutter/lib
into nyay_flutter, patches the two pubspecs, deletes the template's demo screen,
and touches nothing else. Re-running it is safe: files whose contents already match
are skipped, and a file it would overwrite is only ever a file this script wrote.
"""

import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
OVERLAY = REPO / 'overlay'
ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
SERVER = ROOT / 'nyay_server'
FLUTTER = ROOT / 'nyay_flutter'

if not SERVER.is_dir():
    sys.exit(
        f'no {SERVER}\n'
        'Create the project first (from the folder that should contain it):\n'
        '  serverpod create nyay --template fullstack --database --webapp\n'
        'then run this script from inside nyay/.'
    )

written = 0


def copy(src: Path, dst: Path) -> None:
    global written
    if dst.exists() and dst.read_text() == src.read_text():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    written += 1
    print(f'  + {dst.relative_to(ROOT)}')


def copy_tree(src: Path, dst: Path, skip_prefix: str = '') -> None:
    if not src.is_dir():
        print(f'  ! missing {src}')
        return
    for path in sorted(p for p in src.rglob('*') if p.is_file()):
        rel = path.relative_to(src).as_posix()
        if skip_prefix and rel.startswith(skip_prefix):
            continue
        copy(path, dst / rel)


def add_deps(pubspec: Path, section: str, deps: dict) -> None:
    """Insert `deps` under `section:` without disturbing what the template put there."""
    if not pubspec.is_file():
        print(f'  ! no {pubspec}')
        return
    text = pubspec.read_text()
    marker = f'\n{section}:\n'
    if marker not in text:
        print(f'  ! {pubspec.name} has no `{section}:` block — add by hand: '
              f'{", ".join(deps)}')
        return
    start = text.index(marker) + len(marker)
    end = len(text)
    match = re.search(r'^\S', text[start:], re.M)
    if match:
        end = start + match.start()
    block = text[start:end]
    insert = ''.join(
        f'  {name}: {spec}\n'
        for name, spec in deps.items()
        if not re.search(rf'^\s+{re.escape(name)}:', block, re.M)
    )
    if insert:
        pubspec.write_text(text[:start] + insert + text[start:])
        print(f'  > {pubspec.name}: {section} += ' + ', '.join(deps))


print('server')
copy_tree(OVERLAY / 'server' / 'lib', SERVER / 'lib', skip_prefix='src/generated/')
for name, target in (
    ('development.yaml', 'development.yaml'),
    ('template.passwords.yaml', 'template.passwords.yaml'),
):
    src = OVERLAY / 'server' / 'config' / name
    if src.is_file():
        copy(src, SERVER / 'config' / target)
passwords = SERVER / 'config' / 'passwords.yaml'
if not passwords.exists():
    copy(OVERLAY / 'server' / 'config' / 'template.passwords.yaml', passwords)
    print('  ! created config/passwords.yaml with placeholders — put your key in it')
copy_tree(OVERLAY / 'server' / 'test', SERVER / 'test')

print('flutter')
if FLUTTER.is_dir():
    copy_tree(OVERLAY / 'flutter' / 'lib', FLUTTER / 'lib')
    demo = FLUTTER / 'lib' / 'screens' / 'greetings_screen.dart'
    if demo.is_file():
        demo.unlink()
        print(f'  - removed {demo.relative_to(ROOT)} '
              '(the template demo calls client.greeting, which this server has no endpoint for)')
else:
    print('  ! no nyay_flutter — was the project created with --template fullstack?')

print('docs and CI')
for name in ('README.md',):
    src = REPO / name
    if src.is_file():
        copy(src, ROOT / name)
for folder in ('docs', 'scripts'):
    src = REPO / folder
    if src.is_dir():
        copy_tree(src, ROOT / folder)
ci = REPO / '.github' / 'workflows' / 'ci.yaml'
if ci.is_file():
    copy(ci, ROOT / '.github' / 'workflows' / 'ci.yaml')

print('pubspecs')
add_deps(SERVER / 'pubspec.yaml', 'dependencies', {'http': '^1.2.0'})
add_deps(SERVER / 'pubspec.yaml', 'dev_dependencies', {
    'test': '^1.25.5',
    'yaml': '^3.1.2',
})
add_deps(FLUTTER / 'pubspec.yaml', 'dependencies', {'web': '^1.1.0'})

for rel in ('.gitignore', 'nyay_server/.gitignore'):
    ignore = ROOT / rel
    if ignore.is_file():
        extra = [g for g in ('config/passwords.yaml', '.env') if g not in ignore.read_text()]
        if extra:
            ignore.write_text(ignore.read_text().rstrip() + '\n' + '\n'.join(extra) + '\n')
            print(f'  > {rel} += {extra}')

print(f'\n{written} files written.\n'
      '\nNext, in this order:\n'
      f'  cd {SERVER.relative_to(ROOT)} && serverpod generate\n'
      '  serverpod start          # from the project root; press M to migrate, then R\n'
      '  cd nyay_flutter && flutter run -d chrome\n'
      '\nSet GEMINI_API_KEY (or edit nyay_server/config/passwords.yaml) first if you\n'
      'want live answers; with neither, the app runs on recorded fixtures and says so.\n')
