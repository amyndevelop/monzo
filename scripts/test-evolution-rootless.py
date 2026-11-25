#!/usr/bin/env python3
"""Tests only generated files in temporary homes. Never starts Docker or systemd."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import socket
import subprocess
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("monzo_rootless", ROOT / "scripts/setup-evolution-rootless.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
LAUNCHER = (ROOT / "deploy/evolution/rootless/dockerd-rootless.sh").read_bytes()
LICENSE = (ROOT / "deploy/evolution/rootless/LICENSE.moby").read_bytes()


class RootlessSetupTests(unittest.TestCase):
    def test_namespace_paths_and_no_global_changes(self):
        home = Path("/home/fixture")
        files = module.plan(home, 1000, LAUNCHER, LICENSE)
        self.assertTrue(all(path.is_relative_to(home) for path in files))
        config = json.loads(files[home / ".config/monzo-evolution/docker/daemon.json"][0])
        self.assertTrue(config["rootless"])
        self.assertEqual(config["hosts"], ["unix:///run/user/1000/monzo-evolution-docker/docker.sock"])
        self.assertTrue(config["data-root"].startswith(str(home / ".local/share/monzo-evolution")))
        self.assertNotIn("iptables", config)
        unit = files[home / ".config/systemd/user/monzo-evolution-docker.service"][0].decode()
        self.assertIn("Delegate=yes", unit)
        self.assertIn("MemoryMax=3G", unit)
        self.assertIn("RuntimeDirectoryMode=0700", unit)
        self.assertIn("--config-file=%h/.config/monzo-evolution/docker/daemon.json", unit)
        self.assertIn("DISABLE_HOST_LOOPBACK=true", unit)
        self.assertNotIn("/etc/docker", unit)
        self.assertNotIn("sysctl", unit)

    def test_private_files_and_idempotence(self):
        with tempfile.TemporaryDirectory(prefix="monzo-rootless-") as directory:
            home = Path(directory)
            paths = module.prepare(home, os.getuid(), LAUNCHER, LICENSE)
            first = {path: path.read_bytes() for path in paths}
            module.prepare(home, os.getuid(), LAUNCHER, LICENSE)
            self.assertEqual(first, {path: path.read_bytes() for path in paths})
            self.assertEqual((home / ".config/monzo-evolution/docker/daemon.json").stat().st_mode & 0o777, 0o600)
            self.assertEqual((home / ".local/lib/monzo-evolution/rootless/dockerd-rootless.sh").stat().st_mode & 0o777, 0o700)

    def test_rejects_root_modified_vendor_and_manual_configuration(self):
        with tempfile.TemporaryDirectory(prefix="monzo-rootless-reject-") as directory:
            home = Path(directory)
            with self.assertRaises(ValueError):
                module.plan(home, 0, LAUNCHER, LICENSE)
            with self.assertRaises(ValueError):
                module.plan(home, 1000, LAUNCHER + b"\n", LICENSE)
            path = home / ".config/monzo-evolution/docker/daemon.json"
            path.parent.mkdir(parents=True)
            path.write_text("manual configuration to preserve\n")
            with self.assertRaises(ValueError):
                module.prepare(home, os.getuid(), LAUNCHER, LICENSE)
            self.assertEqual(path.read_text(), "manual configuration to preserve\n")
            self.assertFalse((home / ".local/lib/monzo-evolution/rootless/dockerd-rootless.sh").exists())

    def test_rejects_links_without_touching_external_target(self):
        with tempfile.TemporaryDirectory(prefix="monzo-rootless-links-") as directory:
            base = Path(directory)
            home, external = base / "home", base / "external"
            home.mkdir()
            external.mkdir()
            (home / ".config").symlink_to(external, target_is_directory=True)
            with self.assertRaises(ValueError):
                module.prepare(home, os.getuid(), LAUNCHER, LICENSE)
            self.assertEqual(list(external.iterdir()), [])
            self.assertFalse((home / ".local").exists())

    def test_rejects_world_writable_parent(self):
        with tempfile.TemporaryDirectory(prefix="monzo-rootless-mode-") as directory:
            home = Path(directory)
            (home / ".config").mkdir(mode=0o777)
            (home / ".config").chmod(0o777)
            with self.assertRaises(ValueError):
                module.prepare(home, os.getuid(), LAUNCHER, LICENSE)
            self.assertFalse((home / ".local").exists())


class RootlessClientTests(unittest.TestCase):
    def invoke(self, metadata=None, create_socket=True):
        with tempfile.TemporaryDirectory(prefix="monzo-client-") as directory:
            base = Path(directory)
            runtime = base / "runtime"
            runtime.mkdir(mode=0o700)
            (runtime / "monzo-evolution-docker").mkdir()
            endpoint = socket.socket(socket.AF_UNIX)
            try:
                if create_socket:
                    endpoint.bind(str(runtime / "monzo-evolution-docker/docker.sock"))
                binary = base / "bin"
                binary.mkdir()
                fake = binary / "docker"
                fake.write_text("""#!/usr/bin/env python3
import json, os, sys
with open(os.environ['MONZO_TEST_LOG'], 'a') as output:
    output.write(json.dumps({'args':sys.argv[1:], 'overrides_present':any(k in os.environ for k in ('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY')), 'docker_config':os.environ.get('DOCKER_CONFIG')}) + '\\n')
if 'info' in sys.argv:
    print(os.environ['MONZO_TEST_META'])
""")
                fake.chmod(0o700)
                logfile = base / "calls.jsonl"
                env = {**os.environ, "PATH":str(binary) + os.pathsep + os.environ['PATH'], "XDG_RUNTIME_DIR":str(runtime), "DOCKER_HOST":"tcp://wrong-daemon.invalid:2375", "DOCKER_CONTEXT":"wrong-context", "DOCKER_TLS_VERIFY":"1", "DOCKER_CONFIG":"/fixture/keep-registry-configuration", "MONZO_TEST_LOG":str(logfile), "MONZO_TEST_META":json.dumps(metadata or {'security':['name=rootless'], 'cgroup':'2', 'driver':'systemd', 'memory':True, 'pids':True})}
                result = subprocess.run([str(ROOT / 'scripts/evolution-docker.sh'), 'version'], env=env, capture_output=True, text=True)
                calls = [json.loads(line) for line in logfile.read_text().splitlines()] if logfile.exists() else []
                return result, calls, str(runtime)
            finally:
                endpoint.close()

    def test_client_targets_private_socket_and_preserves_registry_config(self):
        result, calls, runtime = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(calls), 2)
        for call in calls:
            self.assertEqual(call['args'][0], '--host=unix://' + runtime + '/monzo-evolution-docker/docker.sock')
            self.assertFalse(call['overrides_present'])
            self.assertEqual(call['docker_config'], '/fixture/keep-registry-configuration')
        self.assertEqual(calls[1]['args'][-1], 'version')

    def test_missing_socket_never_falls_back_to_another_daemon(self):
        result, calls, _runtime = self.invoke(create_socket=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])

    def test_rootful_and_unlimited_engines_stop_before_the_requested_command(self):
        for metadata in [
            {'security':['name=apparmor'], 'cgroup':'2', 'driver':'systemd', 'memory':True, 'pids':True},
            {'security':['name=rootless'], 'cgroup':'2', 'driver':'none', 'memory':True, 'pids':True},
            {'security':['name=rootless'], 'cgroup':'2', 'driver':'systemd', 'memory':False, 'pids':True},
        ]:
            with self.subTest(metadata=metadata):
                result, calls, _runtime = self.invoke(metadata)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
