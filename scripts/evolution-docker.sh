#!/usr/bin/env bash
# Always target MONZO's dedicated rootless engine; never select a global context.
set -euo pipefail
monzo_uid=$(id -u)
if [ "$monzo_uid" = 0 ]; then
  echo 'Ejecutá este comando sin sudo, como el usuario que preparó MONZO.' >&2
  exit 1
fi
monzo_runtime="${XDG_RUNTIME_DIR:-/run/user/$monzo_uid}"
if [ -L "$monzo_runtime" ] || [ ! -d "$monzo_runtime" ] || [ "$(stat -c %u -- "$monzo_runtime")" != "$monzo_uid" ] || [ "$(stat -c %a -- "$monzo_runtime")" != 700 ]; then
  echo 'El directorio de sesión debe pertenecer al usuario y tener permisos 0700.' >&2
  exit 1
fi
monzo_socket="$monzo_runtime/monzo-evolution-docker/docker.sock"
if [ ! -S "$monzo_socket" ]; then
  echo 'El servicio privado de MONZO todavía no tiene un socket disponible.' >&2
  echo 'Revisá: systemctl --user status monzo-evolution-docker.service' >&2
  exit 1
fi
monzo_client=(env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host="unix://$monzo_socket")
monzo_info=$("${monzo_client[@]}" info --format '{"security":{{json .SecurityOptions}},"cgroup":{{json .CgroupVersion}},"driver":{{json .CgroupDriver}},"memory":{{json .MemoryLimit}},"pids":{{json .PidsLimit}}}')
printf '%s' "$monzo_info" | python3 -c '
import json, sys
info = json.load(sys.stdin)
if "name=rootless" not in info.get("security", []):
    sys.exit("El motor no se identificó como rootless; operación cancelada.")
if str(info.get("cgroup")) != "2" or info.get("driver") != "systemd" or not info.get("memory") or not info.get("pids"):
    sys.exit("Falta soporte para los límites de memoria/procesos. Revisá la delegación de cgroups antes de iniciar Evolution.")
'
exec "${monzo_client[@]}" "$@"
