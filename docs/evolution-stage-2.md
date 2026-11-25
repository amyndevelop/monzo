# Evolution · Etapa 2: infraestructura y diagnóstico autenticado

Estado: preparación en rama independiente `feat/evolution-integration`, desde `92e435032889a571f83a98d8a1c04aa49e9807fa`. No implica instalación en el VPS ni publicación en Vercel. Dominio elegido: **https://onlineboosty.com.ar**, raíz del dominio, sin subdominio. Su contenido actual se reemplazará cuando el usuario apruebe el despliegue.

## Alcance y resultado esperado

El stack levanta Evolution API, una base PostgreSQL exclusiva, Redis exclusivo y un gateway Node pequeño. MONZO incorpora en Canales una comprobación explícita del servicio y versión, de la credencial interna y de un retorno HMAC autenticado. Un resultado correcto demuestra esos tres controles en ese momento; **no demuestra que un número esté vinculado ni que un mensaje haya llegado**.

Esta etapa no crea instancias Evolution, no conecta QR ni procesa mensajes. El Baileys y Meta existentes siguen sus caminos actuales. La Etapa 3 deberá implementar eventos durables, aislamiento por instancia/empresa, ciclo QR, adjuntos, historial acotado y eventos enviados desde el teléfono antes de conectar un número secundario. No se incorpora una segunda fuente de mensajes parcialmente integrada.

No hay migraciones nuevas del esquema MONZO. Evolution ejecuta sus propias migraciones únicamente en su contenedor PostgreSQL. No darle la URL de Neon ni usar el PostgreSQL del host.

## Topología y protección

```text
MONZO (servidor Vercel) → HTTPS onlineboosty.com.ar/v1/diagnostics
  → Nginx existente → 127.0.0.1:18085 → gateway
  → Evolution:8080 (red Docker privada) → PostgreSQL / Redis propios
  → POST firmado al origen exacto de MONZO /api/integrations/evolution/probe
```

Nginx publica solo POST `/v1/diagnostics`; el resto responde 404. Abrir el dominio en un navegador no muestra una consola de administración. No se exponen Manager, Swagger, base de datos, Redis ni API administrativa de Evolution. El puerto 18085 escucha únicamente en loopback. Se conserva el Nginx actual de 80/443 y los otros servicios del VPS.

Las cinco claves se generan una vez, son independientes y se conservan al repetir setup. `.env.evolution` y `.evolution/vercel.env` son privados (0600), el directorio es 0700, y ambos están ignorados por Git. No ejecutar `docker compose config`, `docker inspect` completo ni mostrar estos archivos en el chat: pueden revelar claves. El diagnóstico devuelve exclusivamente códigos acotados; nunca devuelve listas de instancias o credenciales.

MONZO exige sesión verificada y membresía; solo OWNER puede comprobar. La mutación exige origen correcto y JSON estricto. Hay tres comprobaciones por empresa/minuto; el gateway limita concurrencia a dos y veinte solicitudes autenticadas/minuto. El retorno HMAC vincula cuerpo, tiempo y nonce; acepta hasta 60 segundos de diferencia. Es una operación idempotente sin efectos; puede repetirse dentro de ese intervalo. No reutilizar este endpoint como receptor de mensajes. El receptor durable de Etapa 3 necesitará deduplicación persistente y su propia firma.

La URL de retorno queda fija en el VPS y debe coincidir con el origen MONZO que solicita la comprobación. No acepta destinos arbitrarios ni redirecciones. Un preview necesita credenciales y datos independientes de producción. La protección de acceso de Vercel puede impedir el retorno: resolverla para el preview autorizado sin desactivar la autenticación de MONZO. No enviar claves de bypass en URLs ni al navegador.

## Versiones y cambio mínimo de la imagen

- Evolution API **2.3.8**, upstream commit `182c255ae351ff31043d7d6b872799b809338c42`, imagen `evoapicloud/evolution-api:v2.3.8@sha256:b2712c06caf333c7a7ade3bbbdd25f70c32abb74537ec75f786c24c99675deb3`.
- PostgreSQL 17, Redis 7 y Node 24 están fijados por digest en Compose/Dockerfile. No usar `latest` ni actualizar sin validar compatibilidad.
- Imagen derivada: ejecuta como `node`; permite escribir solo donde el entrypoint de migración/generación Prisma lo requiere. Quita de la respuesta de `/` el campo opcional que consultaba externamente la última versión de WhatsApp. El parche falla durante el build si cambia ese fragmento upstream. No cambia la selección de versión del cliente Baileys.
- CORS conserva el origen exacto MONZO; las consultas internas incluyen ese origen. No se habilita `*`.
- Gateway sin dependencias npm, sistema de archivos de solo lectura, capacidades retiradas y claves en variables del servidor.
- Límite total de memoria de los servicios: aproximadamente 2,4 GiB. El inventario del VPS indicó 3,9 GiB disponibles; volver a medir antes de instalar. Una sesión real y crecimiento de datos deben medirse antes de sumar números.

La versión upstream registra mensajes directamente fuera de `LOG_LEVEL`. Por eso **Evolution utiliza `logging.driver: none`**: su stdout no se conserva ni se reenvía. Los errores detallados del proveedor tampoco estarán disponibles como log histórico. Usar el diagnóstico acotado y salud del stack; nunca habilitar logs brutos con sesiones/clientes reales. Gateway tiene logs rotativos, sin payloads, tokens ni cabeceras de solicitud.

La licencia upstream incluye condiciones adicionales a Apache 2.0. Se conserva en `deploy/evolution/LICENSE.upstream`; el aviso de uso se muestra en Canales y aquí. Esta integración **utiliza Evolution API**, © 2026 Evolution Foundation. Ver [licencia upstream](https://github.com/evolution-foundation/evolution-api/blob/2.3.8/LICENSE). No se distribuye su frontend.

## Preparación del VPS, antes de modificarlo

Inventario recibido: Ubuntu 24.04.5, x86_64, 7,7 GiB RAM, 63 GiB de disco libres, Nginx en 80/443, Docker rootful con `sudo`, sin plugin Compose. No cambiar Docker ni PostgreSQL del host. El paquete disponible es `docker-compose-v2`; `docker-compose-plugin` no está en sus repositorios.

Obtener un checkout independiente e inspeccionar su revisión antes de ejecutar el inventario de solo lectura:

```bash
git clone --branch feat/evolution-integration --single-branch https://github.com/amyndevelop/monzo.git monzo-evolution
cd monzo-evolution
git log -1 --oneline
bash scripts/evolution-preflight.sh
```

Revisar la simulación de apt: no proceder si propone retirar/reemplazar Docker o servicios actuales. Identificar el archivo exacto que hoy declara `server_name onlineboosty.com.ar`; conservar copia, destinos y certificados existentes. Revisar A y AAAA para que ambos apunten al VPS que atenderá HTTPS. No se verificó DNS ni se conoce aún ese archivo del servidor. **No copiar un segundo virtual host con el mismo `server_name` sobre el existente ni borrar configuraciones ajenas.**

## Comandos de preparación, después de aprobar instalación

Son instrucciones de operación; no se ejecutaron en el VPS durante el desarrollo. Usar checkout independiente, revisar el commit aprobado y mantener esta rama fuera de `main` hasta aprobar su publicación. No guardar archivos privados dentro de un checkout que se borre al desplegar.

```bash
sudo apt-get update
sudo apt-get -s install --no-install-recommends docker-compose-v2
# Solo si la simulación conserva Docker y los servicios actuales:
sudo apt-get install --no-install-recommends docker-compose-v2
sudo docker compose version
```

Desde el checkout de esta rama, generar configuración sin instalar Node ni cambiar el Node del host:

```bash
read -r -p 'Origen HTTPS exacto del preview de MONZO: ' monzo_preview_origin
sudo docker run --rm --user "$(id -u):$(id -g)" \
  --mount "type=bind,src=$PWD,dst=/workspace" --workdir /workspace \
  node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 \
  node scripts/setup-evolution.mjs --domain onlineboosty.com.ar \
  --monzo-origin "$monzo_preview_origin"
```

Setup no imprime claves, no cambia DNS/Nginx y no arranca servicios. Repetirlo con los mismos destinos conserva claves. Rechaza otro origen/puerto/dominio y archivos Nginx modificados; revisar y preservar la configuración anterior en lugar de borrarla para forzar una regeneración.

Para levantar exclusivamente el proyecto nuevo:

```bash
sudo docker compose --env-file .env.evolution -f compose.evolution.yaml up -d --build --wait
sudo docker compose --env-file .env.evolution -f compose.evolution.yaml ps
curl --fail http://127.0.0.1:18085/healthz
```

No ejecutar `down -v`, `docker system prune` ni reiniciar Docker. No conectar números en esta etapa. La comprobación de salud del gateway solo demuestra que ese proceso responde; el botón de MONZO realiza los controles restantes.

## HTTPS y preview: revisión pendiente del virtual host

Se generan `.evolution/nginx-http.conf` para ACME webroot y `.evolution/nginx-https.conf` para TLS. Son archivos de propuesta, no cambios activos. La instalación deberá usar el **archivo real identificado en el preflight**, respaldarlo y sustituir únicamente ese sitio, tras aprobación. Si el certificado actual es válido puede conservarse; si no existe, usar Certbot webroot con `/var/lib/monzo-evolution/acme`. Revisar antes instalación de Certbot y reglas de firewall; no abrir 18085, PostgreSQL o Redis al público.

Antes de cada recarga: `sudo nginx -t`. Solo si pasa, `sudo systemctl reload nginx`. Verificar que los otros sitios siguen respondiendo. No se provee un comando que sobrescriba una ruta inventada: falta identificar el virtual host del VPS. Esto no impide preparar y probar el stack.

Importar privadamente **las tres variables** de `.evolution/vercel.env` en el entorno Preview de la rama. No pegarlas en este chat. No son variables `NEXT_PUBLIC_*`. El API key global de Evolution y las claves de PostgreSQL/Redis permanecen solo en el VPS. El preview también requiere su origen de autenticación y base de datos de pruebas separados. Crear un deployment nuevo para que reciba las variables; no asumir que un deployment anterior se actualiza.

Abrir Canales como propietario y pulsar **Comprobar servidor**. Servicio, credencial y retorno deben quedar correctos. Un fallo conserva instrucciones visibles y permite repetir. No conectar números ni habilitar automatizaciones basándose solo en esos tres resultados.

## Respaldo y reversión

Antes de sustituir el sitio: conservar su configuración Nginx y anotar sus enlaces actuales; registrar revisión del repositorio e imágenes. Para revertir esta preparación, detener solo este proyecto con `docker compose ... stop`, restaurar exclusivamente el virtual host respaldado, ejecutar `nginx -t` y recargar. No eliminar volúmenes, claves o certificados. El sistema MONZO anterior permanece en su versión actual mientras esta rama no se publique.

Los datos persistentes del nuevo stack están en `monzo-evolution_evolution_database`, `monzo-evolution_evolution_cache` y `monzo-evolution_evolution_instances`. Guardar también configuración privada y claves **cifradas fuera del VPS**, nunca en Git ni backups públicos. Para una copia consistente, detener primero gateway, Evolution y Redis; obtener `pg_dump -Fc -U evolution -d evolution` dentro del servicio `evolution-db` y copiar los volúmenes de instancias/Redis con esos servicios detenidos. No copiar el directorio de datos de PostgreSQL en vivo. Reiniciar solo este proyecto y comprobar salud.

La restauración completa y recuperación de sesiones reales se validará en un stack aislado antes de la Etapa 3/piloto. **No se declara probada una restauración de WhatsApp**, porque no se vinculó ningún número. No habilitar clientes reales hasta completar backups cifrados, restauración verificada y recepción durable.

## Verificación de desarrollo

```bash
node --test services/evolution-gateway/test/*.test.mjs
npm run typecheck
npm run lint
# Con servicios locales y entorno monzo_test aislado:
npm test -- tests/evolution.spec.ts tests/whatsapp-qr.spec.ts tests/whatsapp-qr-runtime.spec.ts
```

Los tests HTTP del gateway usan servidores locales controlados; los de MONZO verifican el callback Next real, autorización y UX de escritorio/móvil. Los reportes de UI son simulados explícitamente en Playwright. No se enviaron mensajes a Meta ni WhatsApp. El build usa Next Webpack. La prueba Docker utiliza la imagen real Evolution, base y Redis propios, y un origen de retorno local de prueba no productivo. La publicación y el retorno desde el VPS por HTTPS se verificarán después de instalar; no están confirmados por las pruebas locales.

Resultados de la preparación local: 12 pruebas Node de gateway/setup y 20 pruebas seleccionadas de MONZO (Evolution y QR existente) pasaron. Build Webpack, TypeScript y lint comprobados. El stack real Evolution 2.3.8 alcanzó salud correcta en sus cuatro servicios; su API aceptó la credencial interna, devolvió 401 sin credencial y el gateway devolvió 404 para rutas administrativas. La prueba de reinicio conserva los volúmenes. Esto no equivale a instalación en el VPS, TLS público, restauración de sesiones ni envío WhatsApp.
