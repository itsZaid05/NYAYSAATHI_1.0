#!/usr/bin/env python3
"""Apply application sources to a freshly generated Serverpod 4.0.3 project.

Usage: python3 /path/to/nyaysaathi/scripts/apply_overlay.py /path/to/nyay

Preserves generated configuration, passwords, protocol code, docs, and Git metadata.
Application source files ARE overwritten: synchronize any local fixes into overlay/
before reapplying. Identical files are skipped. No Dart commands are run here.
"""

import argparse
import re
import shutil
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OVERLAY = REPO / 'overlay'


def patched_pubspec(path: Path, section: str, dependencies: dict[str, str],
                    text: str | None = None) -> str:
    """Add missing dependencies without replacing template versions or overrides."""
    if text is None:
        text = path.read_text(encoding='utf-8')
    match = re.search(rf'^{re.escape(section)}:\s*$', text, re.M)
    if not match:
        raise ValueError(f'{path}: expected a {section}: block; no files were copied')
    start = match.end()
    next_section = re.search(r'^\S', text[start:], re.M)
    end = start + next_section.start() if next_section else len(text)
    block = text[start:end]
    missing = {
        name: version for name, version in dependencies.items()
        if not re.search(rf'^  {re.escape(name)}\s*:', block, re.M)
    }
    if not missing:
        return text
    insertion = ''.join(f'  {name}: {version}\n' for name, version in missing.items())
    return text[:start] + '\n' + insertion + text[start:].lstrip('\n')


def apply(root: Path) -> int:
    root = root.resolve()
    server = root / 'nyay_server'
    flutter = root / 'nyay_flutter'
    required = [server / 'pubspec.yaml', flutter / 'pubspec.yaml',
                root / 'nyay_client' / 'pubspec.yaml']
    for path in required:
        if not path.is_file():
            raise ValueError(f'missing {path}; generate the fullstack nyay project first')
    for path in (OVERLAY / 'server' / 'lib', OVERLAY / 'flutter' / 'lib'):
        if not path.is_dir():
            raise ValueError(f'missing source directory {path}')

    # Validate the dependency sections before writing any project files.
    server_pubspec = server / 'pubspec.yaml'
    flutter_pubspec = flutter / 'pubspec.yaml'
    changes = {
        server_pubspec: patched_pubspec(server_pubspec, 'dependencies', {'http': '^1.2.0'}),
        flutter_pubspec: patched_pubspec(flutter_pubspec, 'dependencies', {'web': '^1.1.0'}),
    }
    changes[server_pubspec] = patched_pubspec(
        server_pubspec, 'dev_dependencies', {'test': '^1.25.5', 'yaml': '^3.1.2'},
        text=changes[server_pubspec],
    )

    written = 0

    def copy(source: Path, destination: Path) -> None:
        nonlocal written
        if destination.is_file() and source.read_bytes() == destination.read_bytes():
            return
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        written += 1
        print(f'  + {destination.relative_to(root)}')

    for source, destination in (
        (OVERLAY / 'server' / 'lib', server / 'lib'),
        (OVERLAY / 'server' / 'test', server / 'test'),
        (OVERLAY / 'flutter' / 'lib', flutter / 'lib'),
        (OVERLAY / 'flutter' / 'test', flutter / 'test'),
    ):
        for path in sorted(source.rglob('*')):
            if not path.is_file() or '__pycache__' in path.parts:
                continue
            relative = path.relative_to(source)
            if relative.as_posix().startswith('src/generated/'):
                continue
            copy(path, destination / relative)

    # Leave generated database credentials and development.yaml intact. This is
    # an additive example only, never a replacement for config/passwords.yaml.
    copy(OVERLAY / 'server/config/template.passwords.yaml',
         server / 'config/nyay.passwords.example.yaml')

    # Remove only the scaffold's known demo files, never whole source directories.
    for relative in (
        'nyay_flutter/lib/screens/greetings_screen.dart',
        'nyay_flutter/test/widget_test.dart',
        'nyay_server/lib/src/greetings/greeting_endpoint.dart',
        'nyay_server/lib/src/greetings/greeting.spy.yaml',
        'nyay_server/test/integration/greeting_endpoint_test.dart',
    ):
        path = root / relative
        if path.is_file():
            path.unlink()
            print(f'  - {relative} (template demo)')

    for path, text in changes.items():
        if path.read_text(encoding='utf-8') != text:
            path.write_text(text, encoding='utf-8')
            written += 1
            print(f'  > {path.relative_to(root)} (dependencies)')

    ignore = root / '.gitignore'
    existing = ignore.read_text(encoding='utf-8') if ignore.exists() else ''
    rules = ('**/config/passwords.yaml', '.env', '.env.*', '**/.dart_tool/',
             '**/build/', '**/.serverpod/', '**/.flutter-plugins*')
    missing = [rule for rule in rules if rule not in existing.splitlines()]
    if missing:
        ignore.write_text(existing.rstrip() + '\n' + '\n'.join(missing) + '\n', encoding='utf-8')

    print(f'\n{written} files written.')
    print(f'Next: cd {server} && serverpod generate')
    print(f'Then follow {REPO / "docs/RUNBOOK.md"} for offline startup and migration.')
    print('Existing configuration and passwords were not overwritten.')
    print('No key, or NYAY_OFFLINE=1, selects labelled hand-written samples.')
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('project', type=Path, help='directory containing nyay_server, nyay_client, nyay_flutter')
    args = parser.parse_args()
    try:
        apply(args.project)
    except (ValueError, OSError) as error:
        parser.exit(1, f'Overlay not applied successfully: {error}\n')


if __name__ == '__main__':
    main()
