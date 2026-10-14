"""Tests only setup file handling; does not simulate a successful Serverpod build."""

import contextlib
import io
import importlib.util
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'apply_overlay.py'
SPEC = importlib.util.spec_from_file_location('apply_overlay', SCRIPT)
overlay = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(overlay)


class ApplyOverlayTests(unittest.TestCase):
    def setUp(self):
        redirect = contextlib.redirect_stdout(io.StringIO())
        redirect.__enter__()
        self.addCleanup(redirect.__exit__, None, None, None)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for package in ('nyay_server', 'nyay_flutter', 'nyay_client'):
            path = self.root / package
            path.mkdir()
            (path / 'pubspec.yaml').write_text(
                f'name: {package}\ndependencies:\n  existing: ^1.0.0\n'
                'dev_dependencies:\n  existing_test: ^2.0.0\n', encoding='utf-8')
        self.config = self.root / 'nyay_server/config'
        self.config.mkdir()
        (self.config / 'passwords.yaml').write_text('development:\n  database: keep-me\n')
        (self.config / 'development.yaml').write_text('database:\n  port: 8090\n')

    def test_preserves_config_and_credentials(self):
        overlay.apply(self.root)
        self.assertEqual((self.config / 'passwords.yaml').read_text(),
                         'development:\n  database: keep-me\n')
        self.assertEqual((self.config / 'development.yaml').read_text(),
                         'database:\n  port: 8090\n')
        self.assertIn('**/config/passwords.yaml', (self.root / '.gitignore').read_text())
        self.assertFalse((self.root / 'README.md').exists())
        self.assertFalse((self.root / 'scripts').exists())

    def test_second_application_is_idempotent(self):
        overlay.apply(self.root)
        before = {p.relative_to(self.root): p.read_bytes()
                  for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(overlay.apply(self.root), 0)
        after = {p.relative_to(self.root): p.read_bytes()
                 for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(before, after)
        server = (self.root / 'nyay_server/pubspec.yaml').read_text()
        self.assertEqual(server.count('  http:'), 1)
        self.assertEqual(server.count('  yaml:'), 1)
        self.assertIn('  existing_test: ^2.0.0', server)

    def test_missing_flutter_fails_before_copying(self):
        (self.root / 'nyay_flutter/pubspec.yaml').unlink()
        with self.assertRaises(ValueError):
            overlay.apply(self.root)
        self.assertFalse((self.root / 'nyay_server/lib').exists())

    def test_malformed_pubspec_fails_before_copying(self):
        (self.root / 'nyay_server/pubspec.yaml').write_text('dependencies:\n  http: ^1.0.0\n')
        with self.assertRaises(ValueError):
            overlay.apply(self.root)
        self.assertFalse((self.root / 'nyay_server/lib').exists())

    def test_keeps_existing_dependency_versions(self):
        path = self.root / 'nyay_server/pubspec.yaml'
        path.write_text('name: nyay_server\ndependencies:\n  http: ^1.5.0\n'
                        'dev_dependencies:\n  test: ^1.27.0\n')
        overlay.apply(self.root)
        text = path.read_text()
        self.assertIn('  http: ^1.5.0', text)
        self.assertIn('  test: ^1.27.0', text)
        self.assertEqual(text.count('  http:'), 1)

    def test_only_known_demo_files_are_removed(self):
        demo = self.root / 'nyay_flutter/lib/screens/greetings_screen.dart'
        custom = demo.with_name('custom.dart')
        demo.parent.mkdir(parents=True)
        demo.write_text('// scaffold')
        custom.write_text('// keep')
        overlay.apply(self.root)
        self.assertFalse(demo.exists())
        self.assertEqual(custom.read_text(), '// keep')


if __name__ == '__main__':
    unittest.main()
