#!/usr/bin/env python3
"""Check/apply only the known onlineboosty vhost, with snapshot and automatic recovery."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
PROPOSAL = ROOT / "deploy/evolution/nginx-onlineboosty.conf"
TARGET = Path("/etc/nginx/sites-available/renovar-onlineboosty")
ENABLED = Path("/etc/nginx/sites-enabled/renovar-onlineboosty")
BACKUPS = Path("/var/backups/monzo-evolution-nginx")
DOMAIN = "onlineboosty.com.ar"


class PublishError(Exception):
    pass


def regular(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise PublishError("Se esperaba un archivo regular, sin enlaces simbólicos.")


def atomic_copy(source, target, metadata):
    fd, name = tempfile.mkstemp(prefix=".monzo-nginx-", dir=target.parent)
    staged = Path(name)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(source.read_bytes())
            output.flush()
            os.fsync(output.fileno())
        os.chown(staged, metadata["uid"], metadata["gid"])
        staged.chmod(metadata["mode"])
        os.replace(staged, target)
    finally:
        staged.unlink(missing_ok=True)


def snapshot_site(target, backups):
    if backups.is_symlink():
        raise PublishError("El directorio de respaldos no puede ser un enlace.")
    backups.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = backups.stat()
    if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise PublishError("El directorio de respaldos debe ser privado y pertenecer al operador.")
    directory = Path(tempfile.mkdtemp(prefix="cambio-", dir=backups))
    info = target.stat()
    content = target.read_bytes()
    metadata = {"uid": info.st_uid, "gid": info.st_gid, "mode": stat.S_IMODE(info.st_mode), "sha256": hashlib.sha256(content).hexdigest()}
    original = directory / "original.conf"
    original.write_bytes(content)
    original.chmod(0o600)
    record = directory / "metadata.json"
    record.write_text(json.dumps(metadata) + "\n")
    record.chmod(0o600)
    return directory, metadata


def validate_snapshot(directory, backups):
    directory = Path(directory)
    if backups.is_symlink() or directory.is_symlink() or directory.parent.resolve() != backups.resolve() or not directory.name.startswith("cambio-"):
        raise PublishError("El respaldo debe pertenecer al directorio de cambios de MONZO.")
    if directory.stat().st_uid != os.geteuid() or stat.S_IMODE(directory.stat().st_mode) != 0o700:
        raise PublishError("El respaldo no tiene el propietario o permisos esperados.")
    regular(directory / "original.conf")
    regular(directory / "metadata.json")
    metadata = json.loads((directory / "metadata.json").read_text())
    if not all(type(metadata.get(key)) is int and metadata[key] >= 0 for key in ("uid", "gid", "mode")) or metadata["mode"] > 0o777:
        raise PublishError("Los metadatos del respaldo no son válidos.")
    if hashlib.sha256((directory / "original.conf").read_bytes()).hexdigest() != metadata.get("sha256"):
        raise PublishError("El respaldo cambió; no se restauró.")
    return metadata


def apply_site(proposal, target, backups, validate, reload_service, postcheck, install_metadata=None):
    regular(proposal)
    regular(target)
    before = target.read_bytes()
    validate(proposal)
    directory, metadata = snapshot_site(target, backups)
    if target.read_bytes() != before or (directory / "original.conf").read_bytes() != before:
        raise PublishError("El sitio cambió durante la comprobación; no se reemplazó.")
    try:
        atomic_copy(proposal, target, install_metadata or metadata)
        validate(target)
        reload_service()
        postcheck()
    except BaseException:
        try:
            atomic_copy(directory / "original.conf", target, metadata)
            validate(target)
            reload_service()
        except BaseException:
            raise PublishError("Falló el cambio y la recuperación requiere revisión. Respaldo: " + str(directory)) from None
        raise PublishError("Cambio cancelado; se restauró la configuración anterior. Respaldo: " + str(directory)) from None
    return directory


def private_nginx_check(candidate, target=TARGET):
    # Mount propagation is private. The running host Nginx keeps its original view.
    subprocess.run(["unshare", "--mount", "--propagation", "private", "--", "sh", "-eu", "-c", 'mount --bind "$1" "$2"\nnginx -t', "monzo-nginx-check", str(candidate), str(target)], check=True)


def preflight():
    regular(TARGET)
    regular(PROPOSAL)
    if ENABLED.resolve(strict=True) != TARGET:
        raise PublishError("El enlace del sitio cambió; revisalo antes de continuar.")
    cert = "/etc/letsencrypt/live/onlineboosty.com.ar/fullchain.pem"
    subprocess.run(["openssl", "x509", "-in", cert, "-noout", "-checkend", "86400"], check=True)
    host = subprocess.run(["openssl", "x509", "-in", cert, "-noout", "-checkhost", DOMAIN], check=True, capture_output=True, text=True)
    if "does match certificate" not in host.stdout:
        raise PublishError("El certificado no coincide con onlineboosty.com.ar.")
    subprocess.run(["nginx", "-t"], check=True)
    with urllib.request.urlopen("http://127.0.0.1:18085/healthz", timeout=5) as response:
        health = json.loads(response.read(4097))
    if health.get("ok") is not True or health.get("protocol") != "monzo-evolution-v1":
        raise PublishError("El gateway local no respondió con el protocolo esperado.")


def reload_nginx():
    subprocess.run(["systemctl", "reload", "nginx"], check=True)


def https_check():
    result = subprocess.run(["curl", "--silent", "--show-error", "--max-time", "10", "--resolve", DOMAIN + ":443:127.0.0.1", "--request", "POST", "--header", "Content-Type: application/json", "--data", "{}", "--output", "/dev/null", "--write-out", "%{http_code}", "https://" + DOMAIN + "/v1/diagnostics"], check=True, capture_output=True, text=True)
    if result.stdout.strip() != "401":
        raise PublishError("La comprobación HTTPS sin credencial no devolvió el 401 esperado.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--check", action="store_true", help="Validar sin reemplazar el sitio activo (opción predeterminada).")
    modes.add_argument("--apply", action="store_true", help="Respaldar y reemplazar solo el sitio identificado, tras aprobación.")
    modes.add_argument("--rollback", metavar="DIRECTORIO", help="Restaurar un respaldo anterior creado por esta herramienta.")
    args = parser.parse_args()
    try:
        if os.geteuid() != 0:
            raise PublishError("Este paso requiere sudo para comprobar los certificados y Nginx.")
        if args.rollback:
            directory = Path(args.rollback)
            metadata = validate_snapshot(directory, BACKUPS)
            regular(TARGET)
            if ENABLED.resolve(strict=True) != TARGET:
                raise PublishError("El enlace del sitio cambió; no se restauró.")
            previous = apply_site(directory / "original.conf", TARGET, BACKUPS, private_nginx_check, reload_nginx, lambda: None, install_metadata=metadata)
            print("Configuración del sitio restaurada desde el respaldo indicado.")
            print("Respaldo de la configuración reemplazada: " + str(previous))
        else:
            preflight()
            if not args.apply:
                private_nginx_check(PROPOSAL)
                print("Comprobación HTTPS correcta. El sitio activo no se reemplazó ni se recargó.")
                return 0
            def interrupted(_signum, _frame):
                raise KeyboardInterrupt
            for item in (signal.SIGTERM, signal.SIGHUP):
                signal.signal(item, interrupted)
            directory = apply_site(PROPOSAL, TARGET, BACKUPS, private_nginx_check, reload_nginx, https_check)
            print("HTTPS del gateway aplicado. Se comprobó el rechazo sin credencial (HTTP 401).")
            print("Respaldo privado: " + str(directory))
    except KeyboardInterrupt:
        print("Operación interrumpida.", file=sys.stderr)
        return 130
    except PublishError as error:
        print(str(error), file=sys.stderr)
        return 1
    except (OSError, ValueError, subprocess.CalledProcessError):
        print("No se pudo completar la comprobación/publicación. Revisá el error del comando anterior; no compartas claves.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
