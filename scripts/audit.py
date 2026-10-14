#!/usr/bin/env python3
"""Self-check for the overlay: model YAML, constructor args, client calls, banned idioms.

Run it from the repository root: `python3 scripts/audit.py`. It is not a compiler, but
it catches the four classes of mistake that were actually made while writing this code
by hand against 4.0.3 documentation.
"""
import glob
import os
import re
import sys

try:
    import yaml
except ImportError:
    sys.exit('Missing PyYAML. Install scripts/requirements-dev.txt in a virtual environment; see docs/RUNBOOK.md.')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, 'overlay', 'server')
FLUTTER = os.path.join(ROOT, 'overlay', 'flutter')
problems = []
if not os.path.isdir(f'{SERVER}/lib/src/models') or not os.path.isdir(f'{FLUTTER}/lib'):
    sys.exit('Missing overlay sources; run this audit from the submission checkout.')

PRIMITIVES = {'String', 'int', 'double', 'bool', 'DateTime', 'Duration', 'UuidValue',
              'ByteData', 'Object', 'List', 'Map', 'Set'}

models = {}
parsed = {}
for f in sorted(glob.glob(f'{SERVER}/lib/src/models/*.spy.yaml')):
    d = yaml.safe_load(open(f))
    if not isinstance(d, dict):
        problems.append(f'{f}: not a mapping')
        continue
    declarations = [key for key in ('class', 'exception', 'enum') if key in d]
    if len(declarations) != 1 or not isinstance(d.get(declarations[0]), str):
        problems.append(f'{f}: declare exactly one named class, exception, or enum')
        continue
    parsed[f] = d
    name = d.get('class') or d.get('exception') or d.get('enum')
    if not name:
        problems.append(f'{f}: no class/enum/exception key')
        continue
    models[name] = True

for f, d in parsed.items():
    name = d.get('class') or d.get('exception') or d.get('enum')
    if name in models and (d.get('enum') and not d.get('class')):
        values = d.get('values')
        if not isinstance(values, list) or not values:
            problems.append(f'{f}: enum without a non-empty values list')
            continue
        models[name] = {v if isinstance(v, str) else list(v)[0] for v in values}
        continue
    fields = d.get('fields') or {}
    if 'table' in d:
        fields = {**fields, 'id': None}
    models[name] = set(fields)
    for fname, spec in (d.get('fields') or {}).items():
        spec = '' if spec is None else str(spec)
        for type_name in re.findall(r'[A-Z]\w*', spec):
            if type_name in PRIMITIVES:
                continue
            if type_name not in models:
                problems.append(f'{os.path.relpath(f, ROOT)}: {fname} references unknown type {type_name}')
        for flag in (s.strip() for s in spec.split(',')):
            if flag in ('unique', 'setParentNull', 'optional'):
                continue
            if flag.startswith('relation') and 'parent=' not in flag:
                problems.append(f'{os.path.relpath(f, ROOT)}: {fname} relation without parent=')
    for iname, ispec in (d.get('indexes') or {}).items():
        if not isinstance(ispec, dict) or 'fields' not in ispec:
            problems.append(f'{os.path.relpath(f, ROOT)}: index {iname} needs a fields list')
        else:
            for fld in str(ispec['fields']).split(','):
                fld = fld.strip()
                if fld and 'class' in d and fld not in (d.get('fields') or {}) and fld != 'id':
                    problems.append(f'{os.path.relpath(f, ROOT)}: index {iname} on undeclared field {fld}')

files = sorted(
    glob.glob(f'{SERVER}/lib/**/*.dart', recursive=True)
    + glob.glob(f'{SERVER}/test/**/*.dart', recursive=True)
    + glob.glob(f'{SERVER}/bin/*.dart')
    + glob.glob(f'{FLUTTER}/lib/**/*.dart', recursive=True)
    + glob.glob(f'{FLUTTER}/test/**/*.dart', recursive=True)
)
for f in files:
    text = open(f).read()
    rel = os.path.relpath(f, ROOT)
    for bad, why in (
        ("session.logInfo", 'use session.log(msg, level: LogLevel.x)'),
        ("withSession('", 'withSession takes only the callback'),
        ('UuidValue', 'use int foreign keys on 4.0 table models'),
        ('session.ipAddress', 'not on Session in 4.0'),
        ('dart:html', 'use package:web with a kIsWeb guard'),
    ):
        if bad in text:
            problems.append(f'{rel}: banned `{bad}` ({why})')
    for m in re.finditer(r'\b([A-Z]\w*)\(', text):
        name = m.group(1)
        if name not in models or '/generated/' in rel:
            continue
        i, depth, j = m.end(), 1, m.end()
        while j < len(text) and depth:
            depth += {'(': 1, ')': -1}.get(text[j], 0)
            j += 1
        body, args, cur, depth = text[i:j - 1], [], '', 0
        for ch in body:
            depth += {'(': 1, ')': -1, '[': 1, ']': -1, '<': 1, '>': -1}.get(ch, 0)
            if ch == ',' and depth == 0:
                args.append(cur)
                cur = ''
            else:
                cur += ch
        args.append(cur)
        keys = {g for g in (re.match(r'\s*(?:required\s+)?(\w+)\s*:', a) for a in args) if g}
        keys = {k.group(1) for k in keys}
        unknown = sorted(keys - models[name])
        if unknown:
            problems.append(f'{rel}: {name}( passes undeclared {unknown}')

endpoints = {}
for f in glob.glob(f'{SERVER}/lib/src/endpoints/*.dart'):
    ep = os.path.basename(f).replace('_endpoint.dart', '')
    src = open(f).read()
    methods = {}
    for m in re.finditer(
        r'^ {2}(?:@\w+\s*\n *)?[\w<>?, .]+?\s+(?P<name>\w+)\((?P<args>[^)]*)\)'
        r'\s*(?:async\*?|async|;|\{)', src, re.M | re.S):
        params = [a for a in m.group('args').split(',')
                  if a.strip() and 'Session session' not in a]
        methods[m.group('name')] = len(params)
    endpoints[ep] = methods
for f in glob.glob(f'{FLUTTER}/lib/**/*.dart', recursive=True):
    src = open(f).read()
    for m in re.finditer(r'client\.(\w+)\.(\w+)\(([^)]*)\)', src):
        ep, meth, arglist = m.group(1), m.group(2), m.group(3)
        if ep in ('auth', 'connectivityMonitor', 'logs', 'sessions', 'cache', 'storage'):
            continue
        if ep not in endpoints:
            problems.append(f'{os.path.relpath(f, ROOT)}: client.{ep} has no endpoint file')
            continue
        if meth not in endpoints[ep]:
            problems.append(f'{os.path.relpath(f, ROOT)}: client.{ep}.{meth} is not an endpoint method '
                            f'(has {sorted(endpoints[ep])})')
        passed = len([a for a in arglist.split(',') if a.strip()])
        if passed != endpoints[ep][meth]:
            problems.append(f'{os.path.relpath(f, ROOT)}: client.{ep}.{meth} called with {passed} '
                            f'args, endpoint declares {endpoints[ep][meth]}')

print(f'{len(models)} models/enums parsed, {len(files)} dart files audited')
for p in problems:
    print(' •', p)
print('audit clean' if not problems else f'{len(problems)} problems')
sys.exit(1 if problems else 0)
