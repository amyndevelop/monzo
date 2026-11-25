# Evolution · Etapa 2: infraestructura y diagnóstico autenticado

Estado: preparación en rama independiente `feat/evolution-integration`, desde `92e435032889a571f83a98d8a1c04aa49e9807fa`. No implica instalación en el VPS ni publicación en Vercel. Dominio elegido: **https://onlineboosty.com.ar**, raíz del dominio, sin subdominio. Su contenido actual se reemplazará cuando el usuario apruebe el despliegue.

## Operación en el VPS endurecido

El diagnóstico confirmó que el motor Docker del sistema tiene puente, NAT y forwarding deshabilitados. Para este VPS se usa el [motor rootless dedicado a MONZO](evolution-rootless-vps.md). Los comandos de arranque del stack se ejecutan con `./scripts/evolution-compose.sh`, sin sudo. Los comandos de helpers sin red con el motor del sistema permanecen como referencia de la preparación ya realizada.

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

Revisar la simulación de apt: no proceder si propone retirar/reemplazar Docker o servicios actuales. Identificar el archivo exacto que hoy declara `server_name onlineboosty.com.ar`; conservar copia, destinos y certificados existentes. Revisar A y AAAA para que ambos apunten al VPS que atenderá HTTPS. El usuario confirmó que el registro A y la interfaz eth0 del VPS coinciden en **66.97.40.21**. El sitio activo es `/etc/nginx/sites-enabled/renovar-onlineboosty`, enlazado a `/etc/nginx/sites-available/renovar-onlineboosty`. AAAA y la vigencia/renovación del certificado aún deben comprobarse. **No copiar un segundo virtual host con el mismo `server_name` sobre el existente ni borrar configuraciones ajenas.**

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
sudo docker run --rm --network none --user "$(id -u):$(id -g)" \
  --mount "type=bind,src=$PWD,dst=/workspace" --workdir /workspace \
  node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 \
  node scripts/setup-evolution.mjs --domain onlineboosty.com.ar \
  --monzo-origin https://monzo-v-git-feat-evolution-integration-arqen2.vercel.app
```

Los archivos Nginx se preparan para el Certbot existente del VPS (include SSL y webroot `/var/www/letsencrypt`). Setup no imprime claves, no cambia DNS/Nginx y no arranca servicios. Repetirlo con los mismos destinos conserva claves. Rechaza otro origen/puerto/dominio y archivos Nginx modificados; revisar y preservar la configuración anterior en lugar de borrarla para forzar una regeneración.

Para levantar exclusivamente el proyecto nuevo:

```bash
./scripts/evolution-compose.sh up -d --build --wait
./scripts/evolution-compose.sh ps
curl --fail http://127.0.0.1:18085/healthz
```

No ejecutar `down -v`, `docker system prune` ni reiniciar Docker. No conectar números en esta etapa. La comprobación de salud del gateway solo demuestra que ese proceso responde; el botón de MONZO realiza los controles restantes.

## HTTPS y preview: sitio y Certbot identificados

Se generan `.evolution/nginx-http.conf` para ACME webroot y `.evolution/nginx-https.conf` para TLS. Son archivos de propuesta, no cambios activos. La instalación deberá usar el **archivo real identificado en el preflight**, respaldarlo y sustituir únicamente ese sitio, tras aprobación. El certificado configurado está en `/etc/letsencrypt/live/onlineboosty.com.ar/fullchain.pem`, con su clave privada en el mismo directorio. La propuesta conserva esas rutas, el include `/etc/letsencrypt/options-ssl-nginx.conf` y el webroot ACME existente **`/var/www/letsencrypt`**. No volver a emitir el certificado si sigue válido; comprobar vigencia y renovación antes de aplicar. Revisar antes instalación de Certbot y reglas de firewall; no abrir 18085, PostgreSQL o Redis al público.

Antes de cada recarga: `sudo nginx -t`. Solo si pasa, `sudo systemctl reload nginx`. Verificar que los otros sitios siguen respondiendo. El único archivo de sitio a reemplazar será `/etc/nginx/sites-available/renovar-onlineboosty`; se conserva el enlace de `sites-enabled`. Respaldarlo antes, validar el archivo propuesto con `nginx -t` y restaurar la copia si esa validación falla. No instalar un segundo sitio con el mismo dominio.

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

La dirección que se debe cargar como `MONZO_ORIGIN` es la del sitio Preview que Vercel crea para esta rama, accesible en **proyecto MONZO → Deployments → rama feat/evolution-integration → Ready → Visit**. No es la URL del panel de Vercel ni `onlineboosty.com.ar`, que pertenece al gateway. Si el despliegue no existe o falló, resolver primero esa publicación de prueba; no sustituirla por la URL de producción.

## Dirección fija identificada en el estado de Vercel

El check de Vercel del commit `7dcd3ab` publica el dominio de rama **https://monzo-v-git-feat-evolution-integration-arqen2.vercel.app**. Usar ese origen para `MONZO_ORIGIN` del VPS y para `BETTER_AUTH_URL` del entorno Preview específico de esta rama, junto con su base de pruebas y secretos independientes. La URL con hash que se abre desde Visit identifica un despliegue puntual y no es el origen operativo para esta conexión. No cambiar la configuración Production.

La dirección fue identificada desde el check público de GitHub. El entorno de desarrollo bloquea sus solicitudes HTTPS directas a Vercel; por eso todavía debe comprobarse el acceso desde el VPS y no se declara validado el retorno público.

## Preview protegido por Vercel: acceso del VPS

El VPS recibió `HTTP 302` con destino `https://vercel.com/sso-api`. Esto confirma que la autenticación de Vercel intercepta el retorno antes de llegar a MONZO. No quitar Deployment Protection ni cambiar la autenticación de la aplicación.

La integración admite **Protection Bypass for Automation**, la función de Vercel para accesos de servidor. En el proyecto `monzo-v`: **Settings → Deployment Protection → Protection Bypass for Automation**. Crear la clave desde esa sección cuando se haya preparado el archivo privado del VPS; MONZO no puede generar ni inventar una clave aceptada por Vercel. No pegarla en el chat, en argumentos de comandos o en URLs. La clave concede acceso a los despliegues protegidos del proyecto: conservarla solo en el servidor y revocarla en Vercel si se expone.

El gateway lee `VERCEL_AUTOMATION_BYPASS_SECRET` de `.env.evolution` y la manda únicamente en la cabecera `x-vercel-protection-bypass` al origen de retorno fijo bajo `.vercel.app`. Nunca la envía a Evolution, al navegador ni a destinos de redirección. Se conserva la firma HMAC independiente; pasar la protección de Vercel no autoriza solicitudes al probe de MONZO.

La variable es opcional para sitios sin esa protección. Si se proporciona, se validan longitud/formato, que no se reutilice una clave interna, y el destino HTTPS de Vercel. Un retorno con redirección se informa como `CALLBACK_REDIRECT`, sin seguirlo ni mostrar la URL SSO o sus parámetros. Las respuestas de Vercel 401/403 continúan siendo fallos de autorización. No se agregan cookies de sesión ni automatizaciones de inicio de sesión personal.

Después de generar `.env.evolution` con setup, guardar la clave **desde stdin**. Si el host tiene Node 24, estos son los comandos; el valor ingresado no aparece en pantalla ni queda como argumento o entrada literal del historial:

```bash
read -r -s -p 'Clave de automatizaciones de Vercel: ' monzo_vercel_bypass
printf '\n'
printf '%s' "$monzo_vercel_bypass" | node scripts/set-evolution-vercel-bypass.mjs
unset monzo_vercel_bypass
node scripts/check-evolution-preview.mjs
```

Para el VPS, donde no se verificó la versión de Node del host, usar la imagen fijada sin instalar o cambiar Node:

```bash
read -r -s -p 'Clave de automatizaciones de Vercel: ' monzo_vercel_bypass
printf '\n'
printf '%s' "$monzo_vercel_bypass" | sudo docker run --rm -i --network none \
  --user "$(id -u):$(id -g)" \
  --mount "type=bind,src=$PWD,dst=/workspace" --workdir /workspace \
  node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 \
  node scripts/set-evolution-vercel-bypass.mjs
unset monzo_vercel_bypass
sudo docker run --rm --user "$(id -u):$(id -g)" \
  --mount "type=bind,src=$PWD,dst=/workspace" --workdir /workspace \
  node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 \
  node scripts/check-evolution-preview.mjs
```

El setter conserva las otras credenciales, valida el destino y reemplaza atómicamente el archivo con permisos 0600. No copia esta clave a `.evolution/vercel.env`; ese archivo contiene solamente las tres variables de conexión de MONZO. Repetir setup conserva también esta clave. Un valor vacío/incorrecto o un archivo enlazado se rechaza sin escribir. El script de comprobación hace una consulta GET al probe y espera HTTP 405; no envía mensajes ni imprime cuerpos, cabeceras privadas o redirecciones.

Si el stack ya estaba iniciado, aplicar el cambio solo al gateway tras aprobar su actualización:

```bash
./scripts/evolution-compose.sh up -d --build --no-deps --wait evolution-gateway
```

Fuentes oficiales del mecanismo: [variable de entorno de Vercel](https://github.com/vercel/vercel/blob/main/packages/functions/src/get-env.ts) y [cabecera usada por Vercel CLI](https://github.com/vercel/vercel/blob/main/packages/cli/src/commands/curl/index.ts). Las pruebas locales cubren cabecera al destino fijo, ausencia de filtraciones al proveedor, rechazo de claves incorrectas, redirecciones no seguidas y persistencia privada. La aceptación de una clave real por el preview sigue pendiente de configurar y comprobar desde el VPS.

Verificación de este ajuste: 17 pruebas Node de gateway/configuración, 8 pruebas de MONZO (incluyendo escritorio y móvil), TypeScript, lint y build Webpack. Los cuatro servicios Docker locales alcanzan salud correcta con la nueva configuración opcional. El 302 del VPS fue comprobado con su salida enviada por el usuario; no se aplicaron cambios en su VPS ni en Deployment Protection durante el desarrollo.

## Recuperación si no se creó la configuración inicial

La operación en el VPS confirmó que `.env.evolution` todavía no existe. Clonar el repositorio no crea ese archivo: es necesario ejecutar setup y verificar su mensaje final antes de introducir la clave de Vercel. El setter distingue archivo ausente, permisos, entrada vacía/formato y configuración de retorno, con mensajes fijos que no muestran valores privados. No generar otra clave de Vercel para corregir un archivo ausente.

El aviso `IPv4 forwarding is disabled` es independiente del guardado: setup y setter solo necesitan archivos locales y se ejecutan con `--network none`. La conectividad de los contenedores de Evolution deberá resolverse antes de iniciar el servicio y validar su retorno. No habilitar globalmente el reenvío IP ni modificar reglas del firewall sin revisar la configuración del VPS y los servicios existentes.

## Comprobación y publicación HTTPS del sitio identificado

El usuario confirmó en el VPS el motor rootless Docker 29.1.3 con cgroups 2/systemd, los cuatro servicios Evolution/Redis/PostgreSQL/gateway en Healthy, persistencia mediante unidad de usuario y linger, y `http://127.0.0.1:18085/healthz` devolviendo `{"ok":true,"protocol":"monzo-evolution-v1"}`. El forwarding global del VPS continúa en 0. El sitio público todavía no se reemplazó.

La propuesta pública y revisable está en `deploy/evolution/nginx-onlineboosty.conf`. Las pruebas comprueban que coincide con la plantilla generada por setup para el dominio y puerto de este VPS. Solo publica POST `/v1/diagnostics` hacia el gateway local; la raíz del dominio responde 404. MONZO continúa en su dirección de Vercel.

Primero, comprobar desde el VPS, sin publicar:

```bash
sudo python3 scripts/publish-evolution-nginx.py --check
```

Requiere sudo para leer los certificados y ejecutar la comprobación de Nginx. Verifica el enlace exacto del sitio, la vigencia/identidad del certificado, el gateway local y la configuración actual. Después monta temporalmente la propuesta sobre el archivo del sitio **en un namespace de montajes privado**, ejecuta `nginx -t` y termina. No copia archivos sobre la configuración activa, no recarga Nginx ni crea respaldos durante `--check`. No cambiar esta comprobación por un montaje compartido ni por editar primero el archivo activo.

Después de un resultado correcto, revisar el alcance con el usuario y obtener la aprobación de publicación que pidió antes de modificar producción. El paso aprobado será:

```bash
sudo python3 scripts/publish-evolution-nginx.py --apply
```

Se reemplaza únicamente `/etc/nginx/sites-available/renovar-onlineboosty`, conservando el enlace de `sites-enabled`, los permisos/propietario del archivo y las rutas de Certbot. Antes se guarda una copia privada con checksum y metadatos en `/var/backups/monzo-evolution-nginx/cambio-*/`. La copia nueva se instala atómicamente y Nginx vuelve a validarse antes de una **recarga**, sin reiniciar el servicio.

La comprobación posterior usa HTTPS con el nombre del dominio y resolución local a 127.0.0.1. Envía una solicitud sin credencial y exige el rechazo HTTP 401; no carga claves ni realiza llamadas autenticadas de MONZO. Si la validación, recarga o comprobación HTTPS falla, la herramienta restaura automáticamente el archivo anterior y lo recarga. Si también falla esa recuperación, muestra el directorio del respaldo para intervención manual; no declara éxito.

El comando imprime la ruta concreta del respaldo. Para restaurarlo posteriormente, usar esa ruta como argumento de `--rollback`. La restauración verifica el checksum, propiedad y permisos del respaldo, comprueba la propuesta en un namespace privado y guarda también una copia de la configuración que reemplaza. No borra respaldos, certificados, volúmenes ni datos.

Pruebas locales de esta herramienta: publicación en archivos temporales, permisos y checksum; rechazo previo sin cambiar el sitio; restauración ante validación/recarga/HTTPS fallidos; rechazo de cambios concurrentes, enlaces y copias alteradas. Las llamadas reales a Nginx y montajes del VPS se validan con `--check` antes de publicar; los tests locales no se presentan como comprobación real del servidor.

### Recarga de Nginx y diagnóstico posterior

El usuario autorizó aplicar la publicación. El primer intento pasó las validaciones de Nginx y luego restauró automáticamente el sitio anterior; el respaldo privado quedó conservado. La versión inicial no incluía en el mensaje el motivo de la comprobación fallida.

El verificador se ajusta para tolerar el relevo de procesos tras una recarga: reintenta durante una ventana de hasta 15 segundos, con conexiones de tiempo limitado. Conecta directamente a 127.0.0.1:443 y mantiene SNI/Host para `onlineboosty.com.ar`, verificación de nombre/cadena TLS y rechazo sin credenciales. Exige tanto HTTP 401 como el cuerpo JSON acotado `{"error":"UNAUTHORIZED"}` del gateway; un 401 de otra página de autenticación no demuestra acceso al gateway y se rechaza. No sigue redirecciones ni imprime cuerpos de respuesta.

Si sigue fallando, conserva en el mensaje de recuperación la etapa, el HTTP recibido o un diagnóstico fijo de certificado/conexión. No imprime comandos con datos sensibles ni excepciones arbitrarias. Las pruebas cubren la transición 404→401 tras recarga, desconexiones recuperables, límite de reintentos, certificados no confiables, 401 de otro servicio y recuperación con diagnóstico. Una prueba HTTPS local verifica SNI/Host, ruta, ausencia de Authorization, marcador JSON y rechazo de un certificado no confiable. La ventana de espera corrige una posible carrera de recarga; no se declara confirmada la causa exacta del primer intento hasta observar el nuevo resultado del VPS.
