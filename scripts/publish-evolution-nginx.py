#!/usr/bin/env python3
"""Check/apply only the known onlineboosty vhost, with snapshot and automatic recovery."""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import signal
import socket
import ssl
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
PROPOSAL = ROOT / "deploy/evolution/nginx-onlineboosty.conf"
CHANNELS_PROPOSAL = ROOT / "deploy/evolution/nginx-onlineboosty-channels.conf"
TARGET = Path("/etc/nginx/sites-available/renovar-onlineboosty")
ENABLED = Path("/etc/nginx/sites-enabled/renovar-onlineboosty")
BACKUPS = Path("/var/backups/monzo-evolution-nginx")
DOMAIN = "onlineboosty.com.ar"


class PublishError(Exception):
    pass


class HttpsCheckError(PublishError):
    """Contains only a bounded diagnostic, never response bodies or credentials."""
    pass


def failure_reason(error, phase):
    if isinstance(error, HttpsCheckError):
        return str(error)
    if isinstance(error, subprocess.CalledProcessError):
        return phase + " devolvió código " + str(error.returncode)
    if isinstance(error, OSError):
        return phase + " falló por un error del sistema (" + str(error.errno) + ")"
    if isinstance(error, KeyboardInterrupt):
        return "La operación fue interrumpida"
    return "Falló la etapa: " + phase


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
    phase = "instalación del archivo"
    try:
        atomic_copy(proposal, target, install_metadata or metadata)
        phase = "validación de Nginx"
        validate(target)
        phase = "recarga de Nginx"
        reload_service()
        phase = "comprobación HTTPS"
        postcheck()
    except BaseException as error:
        reason = failure_reason(error, phase)
        try:
            atomic_copy(directory / "original.conf", target, metadata)
            validate(target)
            reload_service()
        except BaseException:
            raise PublishError("Falló el cambio y la recuperación requiere revisión. Motivo: " + reason + ". Respaldo: " + str(directory)) from None
        raise PublishError("Cambio cancelado; se restauró la configuración anterior. Motivo: " + reason + ". Respaldo: " + str(directory)) from None
    return directory


def private_nginx_check(candidate, target=TARGET):
    # Mount propagation is private. The running host Nginx keeps its original view.
    subprocess.run(["unshare", "--mount", "--propagation", "private", "--", "sh", "-eu", "-c", 'mount --bind "$1" "$2"\nnginx -t', "monzo-nginx-check", str(candidate), str(target)], check=True)


def preflight(proposal=PROPOSAL):
    regular(TARGET)
    regular(proposal)
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


def probe_local_https(timeout, *, address=("127.0.0.1", 443), context=None, path="/v1/diagnostics"):
    # Connect locally but validate the certificate and SNI for the real domain.
    # No DNS/proxy redirect, authentication header, or customer data is involved.
    context = context or ssl.create_default_context()
    connection = http.client.HTTPSConnection(DOMAIN, timeout=timeout, context=context)
    try:
        raw = socket.create_connection(address, timeout=timeout)
        try:
            connection.sock = context.wrap_socket(raw, server_hostname=DOMAIN)
        except BaseException:
            raw.close()
            raise
        connection.request("POST", path, body=b"{}", headers={"Content-Type": "application/json", "Connection": "close"})
        response = connection.getresponse()
        body = response.read(4097)
        matched = False
        if len(body) <= 4096:
            try:
                matched = json.loads(body) == {"error": "UNAUTHORIZED"}
            except (ValueError, UnicodeError, RecursionError):
                pass
        return response.status, matched
    finally:
        connection.close()


def https_check(*, probe=probe_local_https, clock=time.monotonic, pause=time.sleep, budget=15.0):
    # Reload only signals Nginx. Give its new workers a bounded time to take over.
    deadline = clock() + budget
    reason = "Sin respuesta HTTPS"
    while True:
        remaining = deadline - clock()
        if remaining <= 0:
            raise HttpsCheckError(reason + "; se esperaba HTTP 401 del gateway")
        try:
            status, matched = probe(min(3.0, remaining))
            if status == 401 and matched:
                return
            if type(status) is int and 100 <= status <= 599:
                reason = "HTTP " + str(status)
                if status == 401:
                    reason += " con una respuesta que no corresponde al gateway"
            else:
                reason = "Respuesta HTTP no válida"
        except ssl.SSLCertVerificationError:
            raise HttpsCheckError("El certificado HTTPS local no pasó la verificación de confianza/nombre") from None
        except ssl.SSLError:
            reason = "No se completó la conexión TLS local"
        except (OSError, http.client.HTTPException):
            reason = "No se obtuvo una respuesta HTTPS local"
        remaining = deadline - clock()
        if remaining <= 0:
            raise HttpsCheckError(reason + "; se esperaba HTTP 401 del gateway")
        pause(min(0.5, remaining))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--check", action="store_true", help="Validar sin reemplazar el sitio activo (opción predeterminada).")
    modes.add_argument("--apply", action="store_true", help="Respaldar y reemplazar solo el sitio identificado, tras aprobación.")
    modes.add_argument("--rollback", metavar="DIRECTORIO", help="Restaurar un respaldo anterior creado por esta herramienta.")
    parser.add_argument("--channels", action="store_true", help="Usar la propuesta acotada de QR y mensajes de la Etapa 3.")
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
            proposal = CHANNELS_PROPOSAL if args.channels else PROPOSAL
            preflight(proposal)
            if not args.apply:
                private_nginx_check(proposal)
                print("Comprobación HTTPS correcta. El sitio activo no se reemplazó ni se recargó.")
                return 0
            def interrupted(_signum, _frame):
                raise KeyboardInterrupt
            for item in (signal.SIGTERM, signal.SIGHUP):
                signal.signal(item, interrupted)
            def verify_routes():
                paths = ["/v1/diagnostics"]
                if args.channels:
                    paths += ["/v1/channels/command", "/v1/channels/state"]
                for path in paths:
                    https_check(probe=lambda timeout: probe_local_https(timeout, path=path))
            directory = apply_site(proposal, TARGET, BACKUPS, private_nginx_check, reload_nginx, verify_routes)
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
