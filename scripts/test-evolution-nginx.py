#!/usr/bin/env python3
"""Exercise publication and rollback only in temporary directories; never calls host Nginx."""
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("monzo_nginx", ROOT / "scripts/publish-evolution-nginx.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NginxPublicationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="monzo-nginx-test-")
        self.addCleanup(self.directory.cleanup)
        self.base = Path(self.directory.name)
        self.target = self.base / "site.conf"
        self.target.write_text("original site\n")
        self.target.chmod(0o640)
        self.proposal = self.base / "proposal.conf"
        self.proposal.write_text("proposed site\n")
        self.backups = self.base / "backups"

    def apply(self, validate=lambda _path: None, reload_service=lambda: None, postcheck=lambda: None):
        return module.apply_site(self.proposal, self.target, self.backups, validate, reload_service, postcheck)

    def test_success_private_snapshot_and_metadata(self):
        calls = []
        snapshot = self.apply(validate=lambda path: calls.append(path), reload_service=lambda: calls.append("reload"), postcheck=lambda: calls.append("https"))
        self.assertEqual(self.target.read_text(), "proposed site\n")
        self.assertEqual(stat.S_IMODE(self.target.stat().st_mode), 0o640)
        self.assertEqual((snapshot / "original.conf").read_text(), "original site\n")
        self.assertEqual(stat.S_IMODE(snapshot.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((snapshot / "original.conf").stat().st_mode), 0o600)
        self.assertEqual(calls, [self.proposal, self.target, "reload", "https"])
        self.assertEqual(module.validate_snapshot(snapshot, self.backups)["mode"], 0o640)

    def test_invalid_proposal_never_changes_site_or_creates_backup(self):
        def reject(_path):
            raise RuntimeError("fixture rejects proposal")
        with self.assertRaises(RuntimeError):
            self.apply(validate=reject)
        self.assertEqual(self.target.read_text(), "original site\n")
        self.assertFalse(self.backups.exists())

    def test_validation_after_replacement_restores_original(self):
        def validate(path):
            if path == self.target and path.read_text() == "proposed site\n":
                raise RuntimeError("fixture rejects active config")
        with self.assertRaisesRegex(module.PublishError, "se restauró"):
            self.apply(validate=validate)
        self.assertEqual(self.target.read_text(), "original site\n")

    def test_reload_failure_and_https_failure_restore_original(self):
        for failure in ("reload", "https"):
            with self.subTest(failure=failure):
                calls = []
                def reload_service():
                    calls.append(self.target.read_text())
                    if failure == "reload" and len(calls) == 1:
                        raise RuntimeError("fixture reload failure")
                def https():
                    if failure == "https":
                        raise RuntimeError("fixture HTTPS failure")
                with self.assertRaisesRegex(module.PublishError, "se restauró"):
                    self.apply(reload_service=reload_service, postcheck=https)
                self.assertEqual(self.target.read_text(), "original site\n")
                self.assertEqual(calls, ["proposed site\n", "original site\n"])

    def test_corrupt_backup_and_symlinks_are_rejected(self):
        snapshot = self.apply()
        (snapshot / "original.conf").write_text("modified snapshot")
        with self.assertRaises(module.PublishError):
            module.validate_snapshot(snapshot, self.backups)
        linked = self.base / "linked.conf"
        linked.symlink_to(self.target)
        with self.assertRaises(module.PublishError):
            module.apply_site(self.proposal, linked, self.backups, lambda _p: None, lambda: None, lambda: None)
        self.assertEqual(self.target.read_text(), "proposed site\n")

    def test_concurrent_change_cancels_before_replacement(self):
        def validate(_path):
            self.target.write_text("another operator's change\n")
        with self.assertRaisesRegex(module.PublishError, "cambió durante"):
            self.apply(validate=validate)
        self.assertEqual(self.target.read_text(), "another operator's change\n")

    def test_isolated_check_uses_private_mount_and_separate_arguments(self):
        with patch.object(module.subprocess, "run") as execute:
            module.private_nginx_check(self.proposal, self.target)
            command = execute.call_args.args[0]
        self.assertEqual(command[:5], ["unshare", "--mount", "--propagation", "private", "--"])
        self.assertEqual(command[-2:], [str(self.proposal), str(self.target)])
        self.assertIn('mount --bind "$1" "$2"', command[-4])
        self.assertNotIn(str(self.proposal), command[-4])


if __name__ == "__main__":
    unittest.main()
