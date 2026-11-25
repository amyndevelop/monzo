#!/usr/bin/env python3
"""Prepare a dedicated rootless engine. Never starts services or edits host Docker/UFW."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

SOURCE_SHA256 = "8eb00d61b5e78ffc0dcd628f056389b5859cc61d6fe3ce17b4a3a4b08143c8a5"
SOURCE_COMMIT = "fbf3ed25f893e6ce21336f1101590e40a13934f4"
SERVICE = "monzo-evolution-docker.service"
ROOT = Path(__file__).resolve().parent.parent


def plan(home, uid, launcher, license_text):
    home = Path(home)
    if uid <= 0 or not home.is_absolute():
        raise ValueError("Ejecutá la preparación como usuario normal, sin sudo.")
    if hashlib.sha256(launcher).hexdigest() != SOURCE_SHA256:
        raise ValueError("El lanzador no coincide con la versión revisada de Docker 29.1.3.")
    config_dir = home / ".config/monzo-evolution/docker"
    library = home / ".local/lib/monzo-evolution/rootless"
    data = home / ".local/share/monzo-evolution/docker"
    runtime = f"/run/user/{uid}/monzo-evolution-docker"
    config = {
        "rootless": True,
        "data-root": str(data),
        "exec-root": runtime + "/exec",
        "pidfile": runtime + "/dockerd.pid",
        "hosts": ["unix://" + runtime + "/docker.sock"],
        "log-level": "warn",
    }
    # Based on Docker's official rootless user-unit template, with project-scoped paths.
    unit = """[Unit]
Description=MONZO Evolution - Docker sin privilegios
Documentation=https://docs.docker.com/engine/security/rootless/
Requires=dbus.socket
StartLimitBurst=3
StartLimitIntervalSec=60

[Service]
Environment=PATH=/usr/sbin:/usr/bin:/sbin:/bin
Environment=DOCKERD=/usr/bin/dockerd
Environment=DOCKERD_ROOTLESS_ROOTLESSKIT_FLAGS=
Environment=DOCKERD_ROOTLESS_ROOTLESSKIT_NET=slirp4netns
Environment=DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER=builtin
Environment=DOCKERD_ROOTLESS_ROOTLESSKIT_DISABLE_HOST_LOOPBACK=true
Environment=DOCKERD_ROOTLESS_ROOTLESSKIT_STATE_DIR=%t/monzo-evolution-docker/rootlesskit
ExecStart=%h/.local/lib/monzo-evolution/rootless/dockerd-rootless.sh --config-file=%h/.config/monzo-evolution/docker/daemon.json
ExecReload=/bin/kill -s HUP $MAINPID
RuntimeDirectory=monzo-evolution-docker
RuntimeDirectoryMode=0700
TimeoutStartSec=120
TimeoutStopSec=90
RestartSec=3
Restart=on-failure
LimitNOFILE=infinity
LimitNPROC=infinity
TasksMax=infinity
MemoryMax=3G
Delegate=yes
Type=notify
NotifyAccess=all
KillMode=mixed
UMask=0077

[Install]
WantedBy=default.target
"""
    return {
        config_dir / "daemon.json": (json.dumps(config, indent=2).encode() + b"\n", 0o600),
        library / "dockerd-rootless.sh": (launcher, 0o700),
        library / "LICENSE.moby": (license_text, 0o600),
        home / ".config/systemd/user" / SERVICE: (unit.encode(), 0o600),
    }


def safe_path(path, home, directory=False):
    for candidate in [path, *path.parents]:
        if candidate == home.parent:
            break
        if candidate.is_symlink():
            raise ValueError("Una ruta de instalación es un enlace simbólico; revisala antes de continuar.")
        if candidate.exists():
            if candidate.stat().st_mode & 0o022:
                raise ValueError("Una ruta permite escritura a otros usuarios; revisala antes de continuar.")
            if candidate.stat().st_uid != os.getuid():
                raise ValueError("Una ruta pertenece a otro usuario; no se modificó.")
            if (candidate != path or directory) and not candidate.is_dir():
                raise ValueError("Se esperaba un directorio de usuario.")


def prepare(home, uid, launcher, license_text):
    home = Path(home)
    files = plan(home, uid, launcher, license_text)
    directories = [home / ".local/share/monzo-evolution/docker"]
    for path, (content, _mode) in files.items():
        safe_path(path, home)
        if path.exists() and (not path.is_file() or path.read_bytes() != content):
            raise ValueError("Un archivo existente difiere; conservá y revisá la configuración antes de reemplazarla.")
    for path in directories:
        safe_path(path, home, directory=True)
    # All preconditions are checked before creating files. Existing user files are preserved.
    for directory in [*directories, *(path.parent for path in files)]:
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    for path, (content, mode) in files.items():
        if not path.exists():
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
            with os.fdopen(fd, "wb") as stream:
                stream.write(content)
        path.chmod(mode)
    return files


def prerequisites():
    if os.getuid() == 0:
        raise ValueError("Ejecutá este comando sin sudo, desde la sesión adminuh.")
    for name in ("dockerd", "docker", "rootlesskit", "slirp4netns", "newuidmap", "newgidmap", "systemctl"):
        if not shutil.which(name):
            raise ValueError("Falta la herramienta: " + name)
    result = subprocess.run(["/usr/bin/dockerd", "--version"], check=True, capture_output=True, text=True)
    if not re.search(r"version 29\.1\.3(?:[,\s]|$)", result.stdout):
        raise ValueError("El lanzador está revisado para Docker 29.1.3. Revisá la versión instalada.")
    runtime = Path(f"/run/user/{os.getuid()}")
    if not runtime.is_dir() or runtime.stat().st_uid != os.getuid():
        raise ValueError("Falta el directorio de sesión /run/user/UID. Ingresá mediante una sesión SSH normal.")
    subprocess.run(["systemctl", "--user", "show-environment"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    bus = subprocess.run(["systemctl", "--user", "show", "dbus.socket", "--property=LoadState", "--value"], check=True, capture_output=True, text=True)
    if bus.stdout.strip() != "loaded":
        raise ValueError("Falta el socket D-Bus del usuario. Revisá dbus-user-session antes de instalar el servicio.")
    if not Path("/sys/fs/cgroup/cgroup.controllers").is_file():
        raise ValueError("Este perfil requiere cgroup v2 para respetar los límites de recursos.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", action="store_true", help="Escribir los archivos del servicio de usuario, sin iniciarlo.")
    args = parser.parse_args()
    try:
        prerequisites()
        launcher = (ROOT / "deploy/evolution/rootless/dockerd-rootless.sh").read_bytes()
        license_text = (ROOT / "deploy/evolution/rootless/LICENSE.moby").read_bytes()
        if args.prepare:
            prepare(Path.home(), os.getuid(), launcher, license_text)
            print("Servicio de usuario preparado. Todavía no se inició ni se habilitó al arranque.")
        else:
            files = plan(Path.home(), os.getuid(), launcher, license_text)
            print("Requisitos disponibles. Archivos que se prepararán:")
            for path in files:
                print(path)
        print("Servicio: " + SERVICE)
        print(f"Socket privado: /run/user/{os.getuid()}/monzo-evolution-docker/docker.sock")
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        if isinstance(error, ValueError):
            print(str(error), file=sys.stderr)
        else:
            print("No se pudo preparar el servicio. Revisá permisos y la sesión systemd del usuario.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
