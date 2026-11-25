# Evolution en el VPS: motor Docker de usuario

## Motivo y estado real

El VPS usa Docker 29.1.3 con `iptables=false`, `ip6tables=false`, `ip-forward=false`, `ip-masq=false` y `bridge=none`. UFW está activo, mantiene FORWARD en DROP y el reenvío IPv4 global es 0. Esa configuración impide usar el Compose de Evolution con el motor del sistema. No editar `/etc/docker/daemon.json`, UFW ni sysctl para habilitar globalmente la red.

El usuario confirmó que `rootlesskit`, `slirp4netns`, `newuidmap` y `newgidmap` ya existen. `adminuh` tiene UID 1000 y rangos subuid/subgid 100000:65536. La creación de una red privada con `rootlesskit --net=slirp4netns --disable-host-loopback` pasó en el VPS, con AppArmor restrictivo activo. El aviso de resolv.conf de esa prueba no implica fallo; el lanzador oficial copia `/etc` y `/run` dentro del entorno privado para manejar esos archivos.

Esta entrega **prepara** un motor de usuario exclusivo para MONZO. No se declaró todavía iniciado en el VPS ni validado el stack Evolution con ese motor. Los servicios anteriores y el motor Docker del sistema quedan fuera de esta instalación.

## Archivos y aislamiento

- Servicio del usuario: `~/.config/systemd/user/monzo-evolution-docker.service`.
- Configuración propia: `~/.config/monzo-evolution/docker/daemon.json` (0600).
- Lanzador: `~/.local/lib/monzo-evolution/rootless/dockerd-rootless.sh` (0700).
- Imágenes y volúmenes: `~/.local/share/monzo-evolution/docker`, fuera del checkout.
- Socket: `/run/user/1000/monzo-evolution-docker/docker.sock`, dentro de un directorio privado 0700. No se publica una API Docker por TCP.
- Red de salida en espacio de usuario mediante slirp4netns, con acceso al loopback del host deshabilitado. El proxy Nginx sí puede conectar al puerto publicado en `127.0.0.1:18085`.
- `MemoryMax=3G` limita el presupuesto agregado del servicio, además de los límites por contenedor del Compose. El perfil requiere cgroup v2; el cliente verifica driver systemd y soporte de límites de memoria/procesos antes de ejecutar operaciones.

El lanzador es el archivo oficial de Moby del tag Docker 29.1.3, commit `fbf3ed25f893e6ce21336f1101590e40a13934f4`, SHA-256 `8eb00d61b5e78ffc0dcd628f056389b5859cc61d6fe3ce17b4a3a4b08143c8a5`. Se conserva sin modificar junto con la licencia Apache 2.0 en `deploy/evolution/rootless/`. El instalador verifica su hash antes de escribir. Se reutiliza el binario `/usr/bin/dockerd` ya instalado; no se descarga ni reemplaza el motor del sistema.

El lanzador habilita forwarding **dentro de su namespace privado**, como requiere Docker. No habilita el forwarding global del VPS. Confirmar tras iniciar que el host sigue mostrando `net.ipv4.ip_forward = 0`.

## Preparación y revisión

Desde el checkout, sin sudo:

```bash
cd ~/monzo-evolution
git pull --ff-only
python3 scripts/setup-evolution-rootless.py
```

El comando anterior comprueba requisitos y muestra el plan, sin escribir. El instalador exige Docker 29.1.3, sesión systemd de usuario, socket D-Bus de usuario y cgroup v2. Si falta un requisito, corregir ese requisito concreto; no desactivar AppArmor ni las restricciones de namespaces del host.

Para escribir los archivos de este servicio nuevo, sin iniciarlo:

```bash
python3 scripts/setup-evolution-rootless.py --prepare
```

Se conservan archivos existentes idénticos. Si hay diferencias, enlaces simbólicos o rutas que otros usuarios pueden modificar, se detiene antes de escribir. No cambia contextos globales de Docker, no toca `.env.evolution` y no modifica otros servicios del usuario. Revisar la unidad/configuración generadas antes de iniciar.

## Inicio del motor, después de aprobar la instalación

```bash
systemctl --user daemon-reload
systemctl --user start monzo-evolution-docker.service
systemctl --user is-active monzo-evolution-docker.service
./scripts/evolution-docker.sh info --format 'Docker {{.ServerVersion}} | cgroups {{.CgroupVersion}} | {{.CgroupDriver}} | {{json .SecurityOptions}}'
sysctl net.ipv4.ip_forward
```

El resultado debe incluir `rootless`, cgroup 2, driver systemd, y el forwarding del host debe continuar en 0. El wrapper rechaza root, sockets ausentes, motores que no se identifican como rootless y límites de memoria/procesos no disponibles. No vuelve silenciosamente al motor del sistema. Conserva la configuración de registro Docker del usuario y elimina solo selectores de endpoint/TLS heredados para fijar el socket local privado.

Una vez comprobado, habilitar persistencia de **este servicio**:

```bash
sudo loginctl enable-linger adminuh
systemctl --user enable monzo-evolution-docker.service
```

Si el motor no inicia, obtener estado/logs solo de la unidad nueva. No reiniciar el Docker del sistema ni los servicios de las otras aplicaciones. Si se actualiza Docker en el host, revisar nuevamente la compatibilidad del lanzador.

## Compose e inicio privado de Evolution

Instalar el plugin de Compose agrega un comando del cliente; no reemplaza Docker. La simulación del VPS confirmó una sola instalación nueva, sin paquetes retirados ni actualizados:

```bash
sudo apt-get install --no-install-recommends docker-compose-v2
./scripts/evolution-docker.sh compose version
```

Antes de construir, comprobar recursos disponibles con `free -h` y `df -h`. Para operar el proyecto se usa **siempre** el wrapper de esta entrega y se ejecuta **sin sudo**:

```bash
./scripts/evolution-compose.sh up -d --build --wait
./scripts/evolution-compose.sh ps
curl --fail http://127.0.0.1:18085/healthz
```

Todavía no reemplaza Nginx ni vincula teléfonos. La publicación de `onlineboosty.com.ar` requiere la revisión y respaldo del virtual host ya identificado en la guía principal. No usar `sudo docker compose` para este stack: apunta a otro motor y carece de la red necesaria en este VPS.

## Helpers privados con el motor de usuario

La configuración actual `.env.evolution` y la clave de Vercel ya guardadas permanecen en el checkout. Las operaciones de archivo anteriores con el motor del sistema y `--network none` eran independientes de esta red.

En rootless, UID 0 **dentro del contenedor** corresponde a `adminuh` en el host. Para leer/escribir los archivos privados 0600, ejecutar los helpers como `--user 0:0`, no con el UID 1000 del host:

```bash
./scripts/evolution-docker.sh run --rm --read-only --user 0:0 \
  --mount "type=bind,src=$PWD,dst=/workspace,readonly" --workdir /workspace \
  node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 \
  node scripts/check-evolution-preview.mjs
```

Debe volver a mostrar el HTTP 405 esperado. Esa prueba comprueba alcance del preview con la clave de Vercel, no la firma HMAC del retorno ni mensajes WhatsApp. Los contenedores de aplicación conservan los usuarios no privilegiados definidos en sus imágenes.

## Reversión y evidencia

Para detener solo este motor nuevo, usar `systemctl --user stop monzo-evolution-docker.service`; para quitar su inicio automático, `systemctl --user disable monzo-evolution-docker.service`. No borrar el directorio de datos, claves, volúmenes ni modificar los motores de otras aplicaciones. Hacer el respaldo cifrado y prueba de restauración del servicio antes de conectar datos reales, según la guía principal.

Pruebas locales: generación idempotente, permisos, rechazo de root/vendor alterado/archivos ajenos/enlaces, cliente apuntando solo al socket privado y rechazo de un motor rootful o sin límites. La unidad pasó verificación sintáctica de systemd y la configuración JSON fue aceptada por `dockerd --validate` de Docker 29.1.3, ejecutado sin red, sin capacidades y sin iniciar un daemon. La ejecución real rootless y los límites efectivos en el VPS se verifican con los comandos de inicio; no se sustituyen por los tests de archivos.

Fuentes: [modo rootless oficial](https://docs.docker.com/engine/security/rootless/), [opciones y límites](https://docs.docker.com/engine/security/rootless/tips/), [lanzador fijado](https://github.com/moby/moby/blob/fbf3ed25f893e6ce21336f1101590e40a13934f4/contrib/dockerd-rootless.sh).
