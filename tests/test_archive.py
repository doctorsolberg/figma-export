import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

SCRIPTS = Path(__file__).resolve().parents[1]


class ArchiveTests(unittest.TestCase):
    def test_commit_and_retry_do_not_duplicate_identical_download(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            report = root / 'backup-report.json'
            report.write_text('{"files":{},"completedFolders":{"keep":{"version":1}}}')
            stage = root / '.playwright-aa.fig'
            with zipfile.ZipFile(stage, 'w') as z:
                z.writestr('canvas.fig', b'fixture')
                z.writestr('meta.json', json.dumps({'file_name': 'Example'}))
            data = stage.read_bytes()
            cmd = [sys.executable, SCRIPTS / 'archive.py', root, stage, 'ABC123',
                   'https://www.figma.com/design/ABC123/example', 'Example', '.fig', '["Team","Design"]']
            previous_report = report.read_text()
            for _ in range(2):
                stage.write_bytes(data)
                subprocess.run([sys.executable, SCRIPTS / 'lock.py', root, *cmd], check=True, capture_output=True)
                self.assertEqual((root / 'backup-report.json.bak').read_text(), previous_report)
                previous_report = report.read_text()
            result = json.loads(report.read_text())
            self.assertEqual(result['files']['ABC123']['path'], 'Team/Design/Example.fig')
            self.assertEqual(len(list(root.rglob('*.fig'))), 1)
            self.assertIn('keep', result['completedFolders'])

    def test_lock_rejects_a_concurrent_writer(self):
        import fcntl
        with tempfile.TemporaryDirectory() as directory:
            with (Path(directory) / '.backup.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                result = subprocess.run([sys.executable, SCRIPTS / 'lock.py', directory,
                                         sys.executable, '-c', 'raise AssertionError'], capture_output=True, text=True)
                self.assertIn('already using', result.stderr)
                self.assertNotEqual(result.returncode, 0)

    def test_environment_marker_does_not_replace_the_lock_descriptor(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            stage = root / '.playwright-aa.fig'
            stage.write_bytes(b'not a zip')
            cmd = [sys.executable, SCRIPTS / 'archive.py', root, stage, 'ABC123',
                   'https://www.figma.com/design/ABC123/example', 'Example', '.fig', '["Team"]']
            result = subprocess.run(cmd, capture_output=True, text=True,
                                    env=dict(os.environ, FIGMA_EXPORT_INTERNAL='1'))
            self.assertIn('lock descriptor', result.stderr)

    def test_corrupt_deflate_is_reported_as_a_validation_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            stage = root / '.playwright-aa.fig'
            with zipfile.ZipFile(stage, 'w', zipfile.ZIP_DEFLATED) as z:
                z.writestr('canvas.fig', b'fixture')
                z.writestr('meta.json', json.dumps({'file_name': 'Example'}))
            with zipfile.ZipFile(stage) as z:
                meta_offset = z.getinfo('meta.json').header_offset
            with stage.open('r+b') as f:
                f.seek(meta_offset + 30 + len('meta.json'))
                f.write(b'\xff')
            cmd = [sys.executable, SCRIPTS / 'archive.py', root, stage, 'ABC123',
                   'https://www.figma.com/design/ABC123/example', 'Example', '.fig', '["Team"]']
            result = subprocess.run([sys.executable, SCRIPTS / 'lock.py', root, *cmd], capture_output=True)
            self.assertEqual(result.returncode, 3, result.stderr)
