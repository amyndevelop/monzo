# Prueba de QR y texto en el Preview

Preparación del 26/11/2026. Estos pasos están preparados y probados localmente; **todavía no se ejecutaron en el VPS**. Es una entrega parcial de la fase 3: vinculación, recepción y respuesta de texto. Los adjuntos de Evolution y la importación del historial anterior siguen pendientes. La API oficial y el QR anterior conservan su implementación.

El usuario confirmó la base independiente `monzo-evolution-test / neondb` con doce migraciones y ya accede al Preview con su cuenta verificada. No hay otra migración para esta entrega. Trabajar en `feat/evolution-conversations`; no integrar `main` ni cambiar Production.

## 1. Preparar los archivos privados

En el VPS, como `adminuh`, sin sudo:

```bash
cd ~/monzo-evolution
git pull --ff-only
./scripts/evolution-docker.sh run --rm --network none --read-only --user 0:0 \
  --mount "type=bind,src=$PWD,dst=/workspace" --workdir /workspace \
  node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 \
  node scripts/prepare-evolution-channels.mjs
```

Se espera `Configuración privada de canales preparada.` y el destino fijo de la rama. El archivo `.evolution/channels.env` conserva las cinco claves, el puerto y el bypass de Etapa 2; cambia el destino al Preview de conversaciones y agrega la bandera y una clave independiente para el spool. No modifica `.env.evolution`, las credenciales de acceso ya cargadas en Vercel, la base ni servicios. Repetir conserva exactamente el archivo. Rechaza Production, archivos enlazados, permisos abiertos y configuración existente incompatible. No borrar los archivos privados para reintentar ni pegarlos en el chat.

## 2. Habilitar solo este Preview y verificar su firma

En Vercel → proyecto `monzo-v` → Settings → Environment Variables, agregar `EVOLUTION_CHANNELS_ENABLED` con valor `true`, sin comillas. Elegir **Preview**, rama **feat/evolution-conversations**. Conservar las variables de la base de pruebas, autenticación, cifrado, SMTP y las tres existentes de Evolution. **EVOLUTION_STORAGE_KEY permanece únicamente en el VPS**.

Desde Deployments, abrir el despliegue cuya Source sea `feat/evolution-conversations` y hacer Redeploy en Preview. No usar el despliegue Production/main del Overview. Esperar Ready y verificar el alias estable:

`https://monzo-v-git-feat-evolution-conversations-arqen2.vercel.app`

Antes de cambiar el servicio del VPS, comprobar la firma del nuevo Preview:

```bash
./scripts/evolution-docker.sh run --rm --read-only --user 0:0 \
  --mount "type=bind,src=$PWD,dst=/workspace,readonly" --workdir /workspace \
  node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 \
  node scripts/check-evolution-preview.mjs --channels --signed
```

Se espera HTTP 200, `Retorno HMAC: OK` y el destino de conversaciones. La comprobación no envía mensajes ni escribe en Neon. Si falla, revisar el estado indicado antes de reconstruir el stack. La opción sin `--signed` solo comprueba acceso GET=405 y no demuestra que las claves coincidan.

## 3. Actualizar el stack privado y publicar las rutas acotadas

```bash
./scripts/evolution-channels-compose.sh up -d --build --wait evolution evolution-gateway
./scripts/evolution-channels-compose.sh ps
curl --fail http://127.0.0.1:18085/healthz
sudo python3 scripts/publish-evolution-nginx.py --channels --check
sudo python3 scripts/publish-evolution-nginx.py --channels --apply
```

El wrapper selecciona el mismo proyecto `monzo-evolution`, volúmenes y motor rootless dedicado, con el archivo nuevo. Conserva las claves/imágenes/configuración de PostgreSQL y Redis; no cambia el daemon global, firewall, forwarding, SSH u otros servicios. No ejecutar `down -v` ni eliminar volúmenes. El servicio de usuario y linger ya fueron habilitados por el operador.

La propuesta HTTPS conserva certificados/ACME y publica exclusivamente POST `/v1/diagnostics`, `/v1/channels/command` y `/v1/channels/state`. La API genérica de Evolution y `/internal/events` continúan sin publicar. El gateway autentica cada petición y aplica límites. El publicador guarda el sitio anterior, valida Nginx antes y después, recarga y exige HTTP 401 con el marcador JSON correcto en las tres rutas. Si falla, restaura el sitio anterior automáticamente. Guardar el directorio de respaldo que informa.

Comprobar la conexión completa con el destino nuevo:

```bash
./scripts/evolution-docker.sh run --rm --read-only --user 0:0 \
  --mount "type=bind,src=$PWD,dst=/workspace,readonly" --workdir /workspace \
  node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 \
  node scripts/check-evolution-connection.mjs --channels
```

Se esperan `Evolution y credencial interna: OK` y `Retorno HMAC a MONZO: OK`. Todavía no confirma un teléfono ni recepción de WhatsApp.

## 4. Prueba física con un número secundario

En el Preview, seleccionar la empresa de pruebas → Canales → **Vinculá tu WhatsApp**. Preparar el número secundario completo con código de país, generar QR y escanear desde ese teléfono: WhatsApp → Dispositivos vinculados → Vincular un dispositivo. Solo el propietario recibe el QR. La interfaz anuncia Conectado después de comprobar que el teléfono coincide; un número diferente se desconecta.

Desde el número personal del cliente, escribir al secundario. Abrir Conversaciones y verificar un solo mensaje, respuesta manual, confirmaciones y recepción en el teléfono. Comprobar también intervención desde el celular, pausa del bot, caducidad/renovación de QR y cierre confirmado. El bot no se activa por vincular un número. Todavía no usar el número principal de BOOSTIFY ni probar imágenes, audios, documentos o importación de historial como si estuvieran terminados.

## Recuperación

Si falla un envío después de contactar al proveedor, queda sin confirmar; no se reenvía automáticamente. Revisar la conversación antes de crear otro envío. Un recibo posterior puede reconciliar el estado. Los eventos se conservan cifrados hasta recibir confirmación firmada de MONZO. Desconectar o volver a vincular cancela pendientes aún no reclamados.

Para retirar la prueba: desconectar los números desde Canales y esperar confirmación; quitar la bandera de este Preview y redeploy. El wrapper anterior `./scripts/evolution-compose.sh up -d --wait evolution evolution-gateway` vuelve al archivo original y al retorno de Etapa 2, con canales deshabilitados. No revierte el modelo de Neon ni borra datos/volúmenes. Para Nginx, `sudo python3 scripts/publish-evolution-nginx.py --rollback` acepta como argumento el directorio exacto de respaldo informado al aplicar; no usar una ruta inventada. No reiniciar, detener ni reconfigurar otros servicios.
