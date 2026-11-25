#!/usr/bin/env python3
"""Exercise publication and rollback only in temporary directories; never calls host Nginx."""
import importlib.util
import http.server
import json
import os
from pathlib import Path
import stat
import ssl
import subprocess
import threading
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


class HttpsReadinessTests(unittest.TestCase):
    def runner(self, responses, budget=1.0):
        elapsed = [0.0]
        calls = []
        def probe(timeout):
            calls.append(timeout)
            item = responses[min(len(calls) - 1, len(responses) - 1)]
            if isinstance(item, BaseException):
                raise item
            return item
        def pause(delay):
            elapsed[0] += delay
        module.https_check(probe=probe, clock=lambda: elapsed[0], pause=pause, budget=budget)
        return calls, elapsed[0]

    def test_graceful_reload_allows_old_worker_before_new_gateway(self):
        calls, elapsed = self.runner([(404, False), (401, True)])
        self.assertEqual(len(calls), 2)
        self.assertEqual(elapsed, 0.5)

    def test_transient_disconnect_can_recover(self):
        calls, _elapsed = self.runner([ConnectionResetError(), (401, True)])
        self.assertEqual(len(calls), 2)

    def test_wrong_http_status_is_bounded_and_reported(self):
        with self.assertRaisesRegex(module.HttpsCheckError, "HTTP 404"):
            self.runner([(404, False)])

    def test_401_from_another_service_is_not_accepted(self):
        with self.assertRaisesRegex(module.HttpsCheckError, "no corresponde al gateway"):
            self.runner([(401, False)])

    def test_certificate_verification_never_skipped_or_retried(self):
        calls = []
        def reject(_timeout):
            calls.append(True)
            raise ssl.SSLCertVerificationError("private failure details must not be printed")
        with self.assertRaisesRegex(module.HttpsCheckError, "certificado HTTPS") as failure:
            module.https_check(probe=reject)
        self.assertEqual(len(calls), 1)
        self.assertNotIn("private failure", str(failure.exception))

    def test_rollback_preserves_safe_https_reason(self):
        case = NginxPublicationTests()
        case.setUp()
        try:
            def reject():
                raise module.HttpsCheckError("HTTP 502; se esperaba HTTP 401 del gateway")
            with self.assertRaisesRegex(module.PublishError, "HTTP 502"):
                case.apply(postcheck=reject)
            self.assertEqual(case.target.read_text(), "original site\n")
        finally:
            case.doCleanups()

    def test_unknown_errors_do_not_expose_values(self):
        case = NginxPublicationTests()
        case.setUp()
        try:
            def reject():
                raise RuntimeError("private-fixture-value-not-for-output")
            with self.assertRaises(module.PublishError) as failure:
                case.apply(postcheck=reject)
            self.assertIn("comprobación HTTPS", str(failure.exception))
            self.assertNotIn("private-fixture-value", str(failure.exception))
        finally:
            case.doCleanups()


class RealHttpsProbeTests(unittest.TestCase):
    def test_tls_hostname_method_and_gateway_marker(self):
        with tempfile.TemporaryDirectory(prefix="monzo-local-tls-") as directory:
            base = Path(directory)
            cert, key = base / "cert.pem", base / "key.pem"
            subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=" + module.DOMAIN, "-addext", "subjectAltName=DNS:" + module.DOMAIN, "-keyout", str(key), "-out", str(cert)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            key.chmod(0o600)
            class Handler(http.server.BaseHTTPRequestHandler):
                def log_message(self, _format, *_args):
                    pass
                def do_POST(self):
                    self.server.seen.append((self.path, self.headers.get('Host'), self.headers.get('Authorization'), self.rfile.read(int(self.headers['Content-Length']))))
                    self.send_response(401)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(self.server.payload)))
                    self.end_headers()
                    self.wfile.write(self.server.payload)
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            server.seen = []
            server.payload = b'{"error":"UNAUTHORIZED"}'
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(certfile=cert, keyfile=key)
            server.socket = context.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                trusted = ssl.create_default_context(cafile=cert)
                self.assertEqual(module.probe_local_https(3, address=server.server_address, context=trusted), (401, True))
                self.assertEqual(server.seen[0], ('/v1/diagnostics', module.DOMAIN, None, b'{}'))
                server.payload = b'<html>different authorization page</html>'
                self.assertEqual(module.probe_local_https(3, address=server.server_address, context=trusted), (401, False))
                with self.assertRaises(ssl.SSLCertVerificationError):
                    module.probe_local_https(3, address=server.server_address)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(5)


if __name__ == "__main__":
    unittest.main()
