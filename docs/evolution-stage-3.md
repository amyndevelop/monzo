# Evolution · Etapa 3: QR y conversaciones

Estado al 26/11/2026: desarrollo en **feat/evolution-conversations**, desde `4f78ceb`. El usuario ya accede al Preview con sesión verificada y empresa de pruebas creada; confirmó la actualización de Neon a doce migraciones. Hay adaptador de instancias, journal cifrado, relay firmado y receptor transaccional de eventos. Todavía no ofrece vinculación Evolution desde Canales ni habilita números. El VPS conserva su stack y retorno de diagnóstico de Etapa 2; el receptor nuevo queda deshabilitado por defecto hasta completar la integración.

## Entorno de pruebas

La base independiente **monzo-evolution-test / neondb** quedó preparada con once migraciones; el usuario cargó su DATABASE_URL en Preview, completó las claves de acceso y SMTP, registró su cuenta y creó BOISTIFY. La captura confirma acceso y sesión verificada en el alias de Etapa 3. No se inspeccionaron los valores privados de Vercel ni se conectó un número. Las pruebas de proveedor se ejecutan localmente con servidores controlados. No usar las credenciales, cola, sesiones ni eventos de producción para probar el nuevo proveedor. Los párrafos siguientes conservan el recorrido de preparación y sus resultados sucesivos.

El usuario creó en Neon una rama **monzo-evolution-test**, desde `main`, seleccionando **Branch schema only**. Su estructura e historial quedaron comprobados con el baseline descrito abajo; todavía no está vinculada a Vercel. Para inspeccionar una copia nueva, en SQL Editor seleccionar explícitamente esa rama y ejecutar [la consulta de solo lectura](sql/evolution-preview-inspect.sql). Se esperan tablas públicas presentes y cero usuarios, empresas, canales, contactos, conversaciones y mensajes. El contador de `_prisma_migrations` puede ser cero antes del baseline porque el historial también es una tabla de datos: no ejecutar `prisma migrate deploy` sobre una copia de esquema sin revisar primero ese historial y comprobar que coincide con las migraciones del repositorio. La consulta usa una transacción de solo lectura y no inicializa historial ni cambia datos. Si la estructura no corresponde o aparece alguna fila de aplicación, detener el alta del Preview y revisar la rama elegida.

### Historial de la copia de esquema

El usuario confirmó cero usuarios, empresas, canales, contactos y conversaciones; una segunda consulta devolvió literalmente **mensajes=0; migraciones=0**. Esto confirma los contadores de esa copia, no que Vercel ya apunte a ella. Se prepara [evolution-preview-baseline.sql](sql/evolution-preview-baseline.sql), para ejecutar completo únicamente en **monzo-evolution-test / neondb**.

El bloque compara la estructura con una referencia construida localmente a partir de los once archivos originales de migraciones: relaciones, columnas/tipos/defaults, restricciones y claves, índices y enums; también detecta triggers y políticas inesperados. Excluye propietarios, OIDs y estadísticas porque no definen la estructura de la aplicación. Bloquea las tablas durante la comprobación/registro para impedir escrituras concurrentes. Si el historial está vacío, exige que **todas** las tablas de aplicación estén vacías y registra solo los once checksums originales en `_prisma_migrations`. No crea, elimina ni altera tablas de aplicación. Un historial parcial/incompatible o una estructura distinta cancelan el bloque; una repetición con historial completo correcto no escribe nada. La selección de rama se realiza en Neon: PostgreSQL no demuestra por el nombre `neondb` que el operador eligió la rama correcta.

Resultado esperado de la consulta final: **neondb | 11 | 0 | 0 | 0** (base, migraciones registradas, usuarios, empresas, mensajes). Esperar esta confirmación antes de usar Prisma para futuras migraciones de esa copia. No ejecutar el bootstrap de una base nueva sobre las tablas ya copiadas.

Generación y validación: `node scripts/prepare-evolution-preview-baseline.mjs` crea y elimina una referencia en el contenedor PostgreSQL de tests local, identificado por servicio/base/puerto antes de operar; no conecta a Neon. `node scripts/test-evolution-preview-baseline.mjs` comprueba esquema equivalente tanto desde migraciones como desde los SQL históricos de SQL Editor, registros/checksums exactos, rechazo de deriva de columnas/defaults/índices/enums/restricciones, datos operativos y registros parciales, rollback forzado después del INSERT, y repetición sin cambios. Los tests usan exclusivamente bases temporales con nombre aleatorio y conservan monzo_test/monzo_dev. Ambas comprobaciones locales pasaron; la ejecución del baseline en Neon todavía depende del usuario.

El primer intento del usuario en Neon se canceló por **estructura incompatible (constraints)** antes del registro del historial. El resto de las secciones coincidieron. Se prepara [una inspección de restricciones de solo lectura](sql/evolution-preview-constraints-inspect.sql): versión de PostgreSQL, cantidad de restricciones NOT NULL registradas en `pg_constraint` y coincidencia del resto con la referencia. PostgreSQL 18 agrega al catálogo restricciones NOT NULL que en PostgreSQL 17 se representaban mediante la columna; el baseline ya verifica `attnotnull` en su sección de columnas. Todavía no se ha confirmado que esa diferencia de versión explique este fallo: no quitar ni recrear restricciones, ignorar la comprobación o forzar el historial sin esa evidencia. La consulta se verificó localmente con coincidencia correcta y deriva real de un CHECK detectada.

El panel de Neon mostró después `Cannot read properties of undefined (reading 'map')`. No es un SQLSTATE y por sí solo no identifica un fallo de PostgreSQL. Para aislar el renderizado de múltiples resultados, la inspección se simplifica a un único SELECT/CTE, sin BEGIN/SET/COMMIT y sin escrituras ni cambios de sesión. Esto todavía no confirma la causa del error de interfaz ni modifica la validación del baseline.

**Causa confirmada y corregida:** la consulta del usuario devolvió **PostgreSQL 18.7 (3190d2f), 166 restricciones NOT NULL y otras_restricciones_coinciden=t**. La comparación inicial trataba el registro adicional de esos NOT NULL como deriva de estructura. El baseline ahora conserva su comprobación de nulabilidad en `attnotnull`, omite solamente los nombres/registros redundantes `contype=n` del fingerprint común entre versiones y exige además que los NOT NULL catalogados estén validados, aplicados y asociados a una única columna obligatoria. No se elimina ni recrea ninguna restricción.

El baseline actualizado pasó nuevamente las pruebas de PostgreSQL 17 y una prueba real de PostgreSQL 18 con los mismos **166** NOT NULL. En PostgreSQL 18 se verificaron la coincidencia con la referencia, once registros y checksums, repetición sin cambios y rechazo al quitar nulabilidad, quitar un CHECK o agregar un NOT NULL NOT VALID. La prueba nueva usa un contenedor temporal sin red, puertos de host o volúmenes persistentes, y lo elimina al terminar; no cambia el PostgreSQL del VPS ni los Compose existentes. Comando local: `node scripts/test-evolution-preview-postgres18.mjs`; la imagen de prueba está fijada por digest en ese archivo. La ejecución exitosa del SQL corregido en Neon sigue pendiente del usuario.

**Baseline de Neon confirmado:** el usuario ejecutó la versión corregida de `f2a9a73` y obtuvo **neondb | 11 | 0 | 0 | 0** (migraciones registradas, usuarios, empresas y mensajes). La rama de pruebas quedó estructuralmente comprobada y con historial compatible; todavía falta conectarla al Preview.

### Conectar solamente el Preview de Etapa 3

En Neon mantener seleccionada **monzo-evolution-test**, abrir **Connect** y copiar privadamente la cadena PostgreSQL de **neondb**. En Vercel, proyecto **monzo-v → Settings → Environment Variables**, crear una variable **DATABASE_URL** con ese URI como valor. Pegar únicamente `postgresql://...`, sin prefijo `psql`, comillas exteriores ni espacios adicionales; conservar los parámetros TLS de la cadena. Elegir **solo Preview** y la rama Git **feat/evolution-conversations**. No reemplazar el valor de DATABASE_URL de Production ni extender a otras ramas esta conexión. No compartir la cadena, contraseña ni capturas del valor en el chat.

Después de guardar será necesario un despliegue nuevo del Preview para recibir el cambio. DATABASE_URL por sí sola no completa la autenticación ni habilita QR: siguen pendientes las variables privadas del Preview, su origen de autenticación, el transporte durable y la integración de Canales. No cambiar todavía el destino fijo del gateway del VPS; ese paso requiere preparar y comprobar el nuevo origen completo.

La captura posterior del usuario muestra **DATABASE_URL en Preview**. No muestra el alcance Git ni permite verificar el valor/conexión runtime. Otra captura confirmó un despliegue Ready de `feat/evolution-conversations`, commit `e0fcc9d`, con el origen fijo **https://monzo-v-git-feat-evolution-conversations-arqen2.vercel.app**. Usar ese origen de rama para BETTER_AUTH_URL; el dominio con hash identifica un deployment puntual y no es el origen de trabajo.

### Preparar las claves privadas del acceso de pruebas

`scripts/prepare-evolution-preview.mjs` genera una vez **BETTER_AUTH_SECRET** y **WHATSAPP_ENCRYPTION_KEY**, independientes entre sí y de los secretos del VPS, y conserva **BETTER_AUTH_URL** de esta rama. Los tres valores se guardan en `.evolution/preview-conversations.env`, archivo privado 0600 bajo directorio 0700 ignorado por Git. Repetir conserva exactamente el archivo; si otro origen, un enlace, permisos amplios o cambios manuales no compatibles aparecen, se detiene sin sobrescribirlo. La publicación inicial del archivo usa un enlace exclusivo para impedir que dos preparaciones concurrentes roten las claves. No imprime valores ni copia DATABASE_URL, SMTP, API keys, bypass o contraseñas de Evolution. Tampoco modifica `.env.evolution`, su destino de retorno o los servicios.

El checkout del VPS se clonó con `--single-branch` y sigue en la rama de Etapa 2. Para incorporar esta rama sin perder los archivos privados ignorados ni reiniciar el stack, agregarla a las referencias de Git, obtenerla y cambiar de rama:

```bash
cd ~/monzo-evolution && git remote set-branches --add origin feat/evolution-conversations && git fetch origin && git switch feat/evolution-conversations
```

Después, desde esa carpeta, ejecutar el helper offline con el motor rootless dedicado. El usuario 0 del contenedor corresponde al adminuh del host y puede leer su archivo privado; el bind de trabajo permite escribir el archivo nuevo mientras la raíz del contenedor queda de solo lectura:

```bash
./scripts/evolution-docker.sh run --rm --network none --read-only --user 0:0 \
  --mount "type=bind,src=$PWD,dst=/workspace" --workdir /workspace \
  node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 \
  node scripts/prepare-evolution-preview.mjs \
  --monzo-origin https://monzo-v-git-feat-evolution-conversations-arqen2.vercel.app
```

Los valores se ingresan privadamente en Vercel, **solo Preview → feat/evolution-conversations**; no compartir el archivo ni capturas de sus valores. Si se cargan uno a uno, pegar el valor sin comillas. Si se pega el contenido `.env` completo mediante el importador del campo Key de Vercel, las comillas pertenecen a la sintaxis del archivo y el importador las procesa. La cuenta nueva de pruebas también necesita SMTP válido para su verificación de correo: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_FROM, SMTP_USER y SMTP_PASSWORD según el proveedor. No desactivar la verificación para resolver una configuración incompleta.

Las cuatro pruebas nuevas del helper y las 32 anteriores pasaron (36): independencia y estabilidad, permisos/propietario, rechazo de producción, origen distinto, enlaces y archivos modificados, CLI sin filtraciones y configuración original del gateway intacta. Las pruebas usan directorios temporales y transporte local controlado, no el archivo real del VPS. La preparación real y carga de esas tres variables siguen pendientes del operador.

También se comprobó dos veces el cambio desde un clon single-branch local, conservando un archivo privado ignorado. El helper se ejecutó con la imagen Node fijada, sin red, raíz de solo lectura y un bind privado de fixture, con el UID propietario: archivo 0600 creado y fuente intacta. Esa ejecución usa Docker local de pruebas y no se presenta como ejecución del comando rootless en el VPS.

La rama de Etapa 3 tendrá su propio Preview y origen de autenticación. Los tres valores de conexión específicos de la rama de Etapa 2 no deben considerarse automáticamente disponibles en esta rama. Antes de operar habrá que preparar variables de Preview, base vacía de pruebas con sus migraciones y destino fijo del gateway. El setup de Etapa 2 rechaza un cambio de origen silencioso: preparar un cambio revisable que conserve las claves, no borrar su configuración para forzarlo. No hay cambio de destino del VPS autorizado ni realizado por este desarrollo local.

## Prueba personal y contenidos

La prueba funcional usa dos números distintos: el teléfono vinculado por QR y el número personal que actúa como cliente. Se mantiene la primera vinculación con un número secundario del plan original; el número principal de BOOSTIFY se incorpora después de validar el recorrido y su alcance de publicación. Los textos comerciales pueden redactarse desde ahora. Para Evolution se usan mensajes y flujos configurables de MONZO; no se usan las plantillas aprobadas de la API oficial de Meta. Su editor, catálogo y envíos siguen disponibles para canales Meta existentes.

Orden del piloto técnico: vincular el secundario, escribir desde el personal, recibir y responder manualmente desde MONZO, comprobar recibos y deduplicación, probar pausa por intervención humana y luego publicar un flujo sencillo con opciones numeradas. Una configuración guardada o un QR renderizado no prueban recepción ni envío reales. No cargar toda la atención comercial antes de verificar ese recorrido. Las ampliaciones del constructor corresponden a la Etapa 4 y no se anuncian como listas.

## Primer componente implementado

`services/evolution-gateway/instance-client.mjs` es un adaptador privado para los contratos de Evolution API 2.3.8, upstream `182c255ae351ff31043d7d6b872799b809338c42`. Se revisaron los controladores y rutas de instancias, las respuestas de `WAMonitoringService`, los DTO de webhook y los eventos Baileys de esa revisión.

- Deriva nombres estables por empresa, cuenta y generación; no acepta nombres de instancia o URLs arbitrarias del solicitante y no incluye teléfonos en los nombres.
- Consulta exclusivamente `fetchInstances?instanceName=...`, valida que la respuesta corresponda a esa instancia y devuelve únicamente estados permitidos. Nunca devuelve tokens, proxies, hash ni la lista de otras cuentas.
- Prepara una instancia con `qrcode: false`, sin iniciar una conexión, sin marcar mensajes/estados como leídos ni sincronizar todo el historial. El QR se solicita explícitamente.
- Prepara una configuración de eventos hacia un receptor interno fijo y distingue la credencial del proveedor de la de eventos mediante contextos HMAC distintos. **Ese receptor durable aún no está implementado**: el adaptador no está registrado como ruta, copiado a la imagen desplegada ni llamado por la aplicación.
- Verifica el teléfono de una conexión abierta contra el esperado. Una identidad ausente o distinta impide anunciar Conectado; el propietario podrá cerrar una vinculación equivocada.
- Limita respuestas y tiempo de espera, no sigue redirecciones y no reintenta mutaciones con resultado incierto. Las respuestas del proveedor no se imprimen en errores.

Este componente es una base de desarrollo; no equivale a integración completa, persistencia de comandos/eventos ni vinculación real. El gateway publicado continúa exponiendo solo el diagnóstico de Etapa 2.

## Persistencia durable del gateway

El Preview ya mostró al usuario con **sesión verificada** y la empresa de pruebas creada (nombre elegido por el usuario: BOISTIFY). La captura confirma el recorrido de acceso; no demuestra una vinculación ni mensajes de Evolution.

`services/evolution-gateway/durable-store.mjs` incorpora un journal local de SQLite nativo de Node 24, sin paquetes nuevos. Los cuerpos, QR y datos de cuenta se cifran con AES-256-GCM y contexto de registro; los hashes de contenido para idempotencia usan HMAC para evitar comparaciones de texto predecible desde una copia del archivo. Solo permanecen en claro identificadores opacos, secuencias, tiempos y estados operativos. El directorio/archivo requieren propietario y permisos privados. Una clave de almacenamiento independiente será necesaria al integrarlo; no se reutiliza la de sesión del Preview.

La conexión SQLite conserva una concesión exclusiva de archivo: un segundo gateway sobre el mismo spool se rechaza. Las transacciones son síncronas, usan WAL y synchronous=FULL y revierten también ante un error interno capturado por el llamador. Se mantienen registros de idempotencia de comandos al reconectar: el mismo comando no puede ejecutarse de nuevo en otra generación. Los pendientes de una generación anterior se cancelan; las escrituras de cuenta obsoletas se rechazan.

Los eventos se reintentan conservando orden por cuenta, con espera y concesión; otra cuenta puede avanzar sin esperar a la primera. Tras un cierre abrupto, un evento no confirmado vuelve a estar disponible. Un comando que estaba ejecutándose pasa a UNKNOWN y no se vuelve a reclamar automáticamente. Resultado y notificación pueden confirmarse en una misma transacción. Los eventos confirmados se purgan tras la retención; los tombstones de envíos permanecen y el contenido antiguo de comandos notificados se redacta. Hay límites de tamaño/cantidad y de páginas SQLite (256 MiB por defecto, más WAL acotado por checkpoints); alcanzar capacidad devuelve error, no borra eventos pendientes para hacer espacio.

Este módulo todavía **no está registrado en main/server, copiado a la imagen del gateway, montado en Compose ni habilitado en el VPS**. No se generaron claves de almacenamiento reales y no hay cambios de esquema de MONZO en este incremento. Falta integrar receptor y relay firmado, ciclo de instancia, envío y front de Canales antes de vincular un número.

Validación: 47 pruebas locales de probe/gateway/instancias/setup/spool pasaron. Las once del spool incluyen recuperación después de un **SIGKILL real** de un proceso de prueba, no reenvío de comandos inciertos, orden, aislamiento, fencing, rollback, límites, retención, clave incorrecta y alteración del ciphertext. Esas mismas once pasaron dentro de la imagen Node fijada, sin red, raíz de solo lectura, almacenamiento temporal, usuario sin privilegios y límite de memoria de 128 MiB. Ninguna usó archivos reales del VPS ni contactó WhatsApp.

## Actualización de la base de pruebas para Evolution

[evolution-preview-upgrade.sql](sql/evolution-preview-upgrade.sql) aplica `202611260001_evolution_channels` únicamente sobre el baseline de pruebas ya preparado. Agrega EvolutionSession (teléfono esperado, estado, QR cifrado y generación), EvolutionDelivery (confirmaciones de eventos deduplicadas) y Message.channelGeneration nullable para distinguir mensajes de conexiones anteriores. Amplía el CHECK de proveedores sin modificar cuentas, credenciales ni mensajes anteriores. No conecta teléfonos ni activa el canal.

El bloque comprueba nombre de base, once migraciones y sus checksums, huella estructural completa y los IDs deterministas del baseline de Preview. **Rechaza el historial original de producción**, aunque su esquema coincida. La operación es atómica, conserva las filas actuales y se puede repetir: si ya existen las doce migraciones compatibles, no escribe. Una copia que contenga esos mismos marcadores también puede cumplir la comprobación; el operador debe mantener seleccionada la rama correcta de Neon.

El usuario debe abrir SQL Editor con **monzo-evolution-test / neondb**, crear una consulta nueva, pegar el archivo completo y ejecutar Run. La fila final muestra base, migraciones, tabla_conexion, tabla_eventos, columna_generacion, usuarios y empresas. Se esperan `neondb | 12 | 1 | 1 | 1`; los dos últimos contadores conservan las cuentas/empresas que ya haya registrado. Compartir únicamente esa fila, no cadenas de conexión ni claves. No ejecutar este archivo en `main` ni volver a aplicar el baseline vacío sobre la base que ahora tiene datos.

El SQL se genera desde las migraciones originales en bases temporales locales. Las pruebas de PostgreSQL 17 y **PostgreSQL 18 real** pasaron: esquema/checksums exactos, conservación de usuario/empresa/canal Meta/contacto/conversación/mensaje y credencial de fixture, rollback después del DDL, repetición sin cambios, rechazo de historial original de producción y deriva. También se comprueban las restricciones de teléfono activo, identidad, generación, deduplicación y claves compuestas entre empresas. El test de PostgreSQL 18 espera por TCP al servidor definitivo para evitar confundirlo con el servidor transitorio de inicialización de la imagen. Ninguna prueba contacta Neon ni usa datos reales.

```bash
node scripts/prepare-evolution-preview-upgrade.mjs
node scripts/test-evolution-preview-upgrade.mjs
node scripts/test-evolution-preview-baseline.mjs
node scripts/test-evolution-preview-postgres18.mjs
```

Orden de publicación: primero se publicaron SQL, migración y herramientas, conservando el modelo Prisma desplegado de once migraciones. Un primer intento se detuvo por falta de marcas; una consulta posterior confirmó once marcas de Preview. Al ejecutar el archivo desde esa misma pestaña, sin cambiar de rama, **el usuario confirmó neondb | 12 | 1 | 1 | 1**, con las dos tablas y la columna nueva. No se atribuye una causa definitiva al primer intento. Los contadores de usuarios/empresas no llegaron completos en la tabla copiada. Ya puede incorporarse el modelo Prisma nuevo: un campo escalar de Message participa en consultas existentes aun si no se habilita Evolution. El build de Vercel no aplica migraciones automáticamente. No cambiar Production, reiniciar el stack del VPS ni cambiar su destino por este paso.

## Relay firmado y receptor transaccional

El protocolo agrega un contexto HMAC exclusivo para eventos (método POST, ruta fija, timestamp, nonce y digest del cuerpo) y otro para el ACK (ID de entrega, digest y nonce del intento). No acepta firmas del probe como autorización de un evento. El relay deriva el destino `/api/integrations/evolution/events` del mismo origen fijo ya validado; nunca sigue redirecciones ni toma URLs del payload. El bypass de Vercel se envía solamente a ese destino. Limita cuerpo a 64 KiB y respuesta a 2 KiB.

El evento permanece pendiente hasta recibir HTTP 200 con ACK exacto y firmado. Una respuesta perdida conserva ID/cuerpo; el reintento usa nonce nuevo. El spool mantiene orden por cuenta y backoff acotado sin descartar pendientes por número de intentos. Un ACK anterior, un eco del cuerpo o HTTP 200 sin prueba válida no confirman nada. Siete pruebas nuevas usan HTTP local y spool temporal; con las anteriores suman 54 aprobadas. El relay todavía no está conectado al loop/imagen desplegados del gateway.

En MONZO, `/api/integrations/evolution/events` queda cerrado con HTTP 503 salvo `EVOLUTION_CHANNELS_ENABLED=true`. **No habilitar esa variable todavía**: faltan comandos, despacho de envíos, normalizador upstream e interfaz. La configuración actual del VPS no cambia y no emite a esta ruta. El receptor verifica firma, tamaño, tiempo y esquema estricto antes de consultar la base. No devuelve secretos, cuerpos ni errores internos. Solo firma el ACK después de confirmar la transacción.

La transacción bloquea la empresa, valida proveedor/cuenta/teléfono/generación y registra EvolutionDelivery junto a sus efectos. Entregas repetidas deben conservar digest y scope; mensajes repetidos se deduplican además por cuenta/providerId. Los QR se cifran con contexto de cuenta/generación y conservan caducidad; eventos de generaciones anteriores no reactivan la sesión. Una identidad incorrecta no habilita el canal. Los recibos avanzan de SENT a DELIVERED/READ sin retroceder y pueden reconciliar UNKNOWN. Un mensaje humano enviado desde el teléfono pausa la automatización y cancela sus respuestas QUEUED; un eco de un envío conocido de MONZO no pausa su propio bot. El historial no dispara automatizaciones ni pausas humanas nuevas.

El worker existente ahora omite explícitamente proveedores distintos de META/BAILEYS para evitar que Evolution intente salir por Meta. Los trabajos automáticos de Evolution quedan pendientes de su despachador específico; esta ruta no constituye todavía un canal utilizable. Las nueve pruebas del receptor pasaron con PostgreSQL real exclusivamente en monzo_test local: duplicados concurrentes, aislamiento, rollback de QR, recibos fuera de orden, intervención humana y rechazo de bytes/esquema/firma antes de escribir. También pasaron tipos, lint, build Webpack y las 28 pruebas existentes de Evolution/WhatsApp en escritorio y móvil. El build necesitó ejecutar sus procesos hijos fuera del sandbox; no se cambió configuración de Next o TypeScript para omitir comprobaciones.

## Integración pendiente

1. Integrar el journal durable con comandos, eventos y generaciones del gateway; completar firma/confirmación del retorno, despacho y límites. Definir almacenamiento de adjuntos privado y acotado antes de habilitarlos.
2. Completar rutas y despachador de Evolution con selección explícita del proveedor, sin reutilizar credenciales de Meta ni la sesión del worker Baileys existente. La migración de Neon ya fue confirmada y el modelo está incorporado.
3. Canales: preparación del teléfono por propietario, escaneo/renovación/caducidad, identidad comprobada, conexión/desconexión y recuperación. QR oculto a miembros sin permiso; abortar solicitudes al cambiar de empresa; confirmación real antes de anunciar Conectado.
4. Conversaciones: recepción/envío, recibos fuera de orden, duplicados, mensajes desde el teléfono, pausa del bot ante intervención humana y recuperación de resultado incierto. Integrar adjuntos e historial acotado con límites explícitos y conservación del compositor/borradores.
5. Persistencia/recuperación real de sesión, backups cifrados y restauración en aislamiento, dos empresas y permisos cruzados, móvil/escritorio/teclado. El número secundario solo se conecta cuando la integración durable esté completa.

UX/UI: mantener la identidad de MONZO, el chat a pantalla completa y el menú plegable. Distinguir preparación, solicitud pendiente, espera de QR, QR vencido, comprobación del teléfono, conectado y desconectado. Los errores deben conservar los datos ingresados y ofrecer una acción concreta; no mostrar credenciales o detalles de infraestructura como decisiones del usuario comercial. La recepción efectiva se confirma por el primer mensaje real y no por el estado técnico del servidor.

## Validación inicial

32 pruebas locales de probe/gateway/setup/instancias aprobadas. Las seis nuevas de instancias usan HTTP local controlado: aislamiento de nombres y rutas, preparación sin conexión automática, respuestas mínimas, identidad, QR inválidos, cierre de teléfono equivocado y resultados inciertos sin reintento. También se comprobaron formato y lint de los archivos nuevos. No se contactó WhatsApp ni se cambió Vercel, Neon, Nginx o el VPS.

```bash
node --import tsx --test --test-isolation=none scripts/test-evolution-probe.mjs services/evolution-gateway/test/*.test.mjs
```
