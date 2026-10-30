# Fase 3 · WhatsApp Cloud API y bandeja

Estado: código integrado y subido a `main` en `a3083f9`, seguido por ajustes de autocompletado y configuración QStash (`15f5f87`, `99d7025`). El usuario confirmó el esquema de producción, autorización del número y recepción real en MONZO. El envío fue rechazado primero por credencial temporal (`META_190`) y, tras renovarla, por destinatario de prueba (`META_131030`). Meta tiene autorizado el formato argentino `54` + número nacional, mientras el webhook identifica el contacto como `549` + número nacional. El ajuste descrito abajo admite esa variante; todavía falta comprobar una respuesta de MONZO recibida en el teléfono.

## Ruta sin servidor permanente · Vercel + QStash

El usuario requiere una alternativa gratuita para las pruebas. Se implementó `WHATSAPP_PROCESSOR=qstash`: las funciones de Vercel procesan entregas HTTP firmadas de Upstash QStash. En este modo no se necesita Redis ni el worker permanente. El modo BullMQ se conserva para desarrollo o un servidor propio, sin ejecutarlo simultáneamente con QStash.

QStash tiene una oferta gratuita con cuotas; confirmar el plan **Free** y los límites vigentes en el panel antes de activar recursos. La página de precios no fue accesible desde la política de red de este entorno. Se consultaron las fuentes oficiales de documentación de Upstash en GitHub para el contrato HTTP y las firmas. No se promete infraestructura ilimitada ni gratuidad futura: también rigen las cuotas de Vercel/Neon y las tarifas que Meta pueda aplicar fuera de la prueba.

Variables adicionales en Vercel, todas privadas:

| Variable                     | Valor/uso                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `WHATSAPP_PROCESSOR`         | `qstash`                                                                           |
| `QSTASH_URL`                 | URL regional oficial indicada por Upstash; por defecto `https://qstash.upstash.io` |
| `QSTASH_TOKEN`               | Token privado para publicar trabajos                                               |
| `QSTASH_CURRENT_SIGNING_KEY` | Clave de firma actual, copiada del panel                                           |
| `QSTASH_NEXT_SIGNING_KEY`    | Siguiente clave de firma, para admitir rotación                                    |

Conservar las tres variables de Meta/cifrado ya guardadas por el usuario, la autenticación y SMTP. No se comparten tokens o claves por chat. No hace falta volver a generar `WHATSAPP_ENCRYPTION_KEY`.

El webhook persiste en PostgreSQL y espera la aceptación de QStash antes de responder 200. Si la publicación falla devuelve 503; la repetición de Meta recupera el mismo registro. Las respuestas guardan primero QUEUED con UUID idempotente; si no se pueden programar, la UI informa que quedaron guardadas y conserva la clave al reintentar. `jobPublishedAt` registra aceptación de la cola, sin afirmar envío o entrega por WhatsApp.

QStash recibe únicamente tipo/ID, sin cuerpos, teléfonos ni tokens de Meta. `/api/jobs/whatsapp` verifica con la biblioteca oficial firma, hash del cuerpo original, emisor, vencimiento y URL exacta configurada; acepta rotación de claves y limita el cuerpo a 2 KiB. Se solicitan dos reintentos (hasta tres intentos). El procesamiento comparte los bloqueos y controles del modo BullMQ. Un recibo tardío puede reconciliar UNKNOWN, que nunca se reenvía automáticamente.

Por cada respuesta se programa además una comprobación demorada de 130 segundos, que marca UNKNOWN si el registro sigue SENDING desde hace más de dos minutos. Cada entrega y reintento consume cuota: un lote HTTP no convierte todas sus entregas en una sola unidad facturable. Si los trabajos se demoran/reordenan, falla la publicación o se agota la cuota, OWNER puede usar **Recuperar pendientes** en Canales. Esa acción revisa resultados inciertos y vuelve a programar únicamente pendientes de su empresa; nunca UNKNOWN. Se procesan hasta 50 recepciones y 50 respuestas por recuperación. No hay cron ni consultas permanentes o mecanismos para eludir límites gratuitos.

La migración adicional `202610290004_event_dispatch` agrega `jobPublishedAt` a Message y WhatsappWebhookEvent sin modificar migraciones previas. El usuario ya aplicó **ambas migraciones nuevas** (tercera y cuarta) en producción y confirmó `neondb | 7 | 4 | 2`. Para probar este modo: `npm run build` y `npm run test:qstash`; usa callbacks HTTP locales y firmas de prueba reales, con transportes explícitos para publicar/llamar a Meta. Estas pruebas locales no establecen una conexión real con QStash; la recepción externa posterior fue confirmada por el usuario.

El usuario creó su cuenta QStash: su captura muestra **Free** en EU Region y US Region. Se indicó US Region y confirmó haber guardado en Vercel las cinco variables de QStash/procesador, además de las tres de Meta/cifrado. No se leyeron esos valores ni se comprobó su conexión real desde este entorno. La captura no muestra la cuota exacta. El usuario también creó su app de Meta y recibió la prueba enviada desde la consola del proveedor; ese mensaje todavía no verifica el recorrido de MONZO.

Pasos pendientes: corregir la configuración de QStash en Vercel, volver a desplegar, recuperar el trabajo pendiente y validar un mensaje completo desde/hacia MONZO. Neon ya tiene las siete tablas nuevas, cuatro migraciones aplicadas y las dos columnas de cola, según la comprobación del usuario.

### Actualización manual de Neon antes de publicar

`docs/sql/phase-3-upgrade.sql` contiene una sola sentencia DO atómica para `monzo-db / main / neondb`, con las migraciones 3 y 4 y sus checksums exactos. Verifica base, historial anterior, duplicados, cambios parciales y presencia de tablas. Conserva cuentas/empresas. Si ya están ambas migraciones completas no las repite; ante un conflicto no aplica cambios parciales. No ejecutar nuevamente el bootstrap de Fase 2.

El archivo se genera sin conexión a bases mediante `node scripts/prepare-phase-3-sql.mjs`. `node scripts/test-phase-3-sql.mjs` lo valida en una base temporal dentro del contenedor local de pruebas, nunca con la URL de producción. Se probaron actualización, conservación de usuarios/empresas/membresías, rollback tras un conflicto DDL, rechazo de base/historial incorrectos, checksums, repetición segura e historial parcial/duplicado. La base temporal se elimina al finalizar.

Ejecutar el bloque completo en el SQL Editor de Neon y confirmar COMMIT si el editor dejó una transacción abierta. Luego ejecutar `docs/sql/phase-3-verify.sql`; resultado esperado `neondb | 7 | 4 | 2` (base, tablas WhatsApp, migraciones aplicadas y columnas de cola). El usuario ejecutó la versión compacta completa y confirmó `neondb | 7 | 4 | 2`. Esta sesión no leyó credenciales de Neon ni ejecutó su SQL de producción. La publicación del código se prepara tras esa confirmación.

## Alcance disponible en esta rama

- Canales: solo OWNER puede autorizar un número mediante WABA ID, Phone Number ID y token. Se comprueba en Meta que el número pertenece a la WABA y se suscribe la app antes de guardar la autorización. El token nunca vuelve a la UI.
- Webhook oficial: desafío GET y HMAC-SHA256 del POST sobre sus bytes originales; límite de 1 MiB. El Verify Token y el App Secret son distintos.
- Recepción durable en PostgreSQL antes de devolver HTTP 200, deduplicación por cuenta/evento e ID de mensaje y procesamiento independiente en BullMQ.
- Contactos e hilos por empresa, búsqueda, filtros abiertos/cerrados, historial paginado y contador de no leídos. Las claves foráneas compuestas protegen también las relaciones del dominio.
- Respuestas de texto en la ventana de 24 horas, con idempotencia por UUID y estados reales. Límite de 30 solicitudes de envío por minuto/empresa y 10 trabajos por segundo/worker; los límites efectivos de Meta pueden ser menores.
- Asignación a miembros actuales, cierre/reapertura y notas internas que nunca salen a WhatsApp. Los miembros pueden asignarse y desasignarse a sí mismos; OWNER/ADMIN pueden asignar a otros integrantes de la empresa.
- Worker Node independiente, Redis/BullMQ, reintentos de recepción, recuperación de pendientes, heartbeat y contenedor de producción sin secretos incluidos.

## Configuración

`npm run setup:local` extiende `.env` y `.env.test` sin reemplazar valores personalizados. Genera claves locales de cifrado/verificación y contraseña Redis; **no genera un App Secret ficticio para la aplicación de desarrollo**. La configuración ficticia de Meta existe únicamente en la base y el entorno de pruebas aislados.

| Variable                        | Uso                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `DATABASE_URL`                  | PostgreSQL del entorno; web y worker deben usar la misma base                          |
| `WHATSAPP_ENCRYPTION_KEY`       | 32 bytes aleatorios en hexadecimal (64 caracteres); idéntica en web y worker           |
| `WHATSAPP_APP_SECRET`           | App Secret real de la app de Meta; valida firmas entrantes en la web                   |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Valor aleatorio ingresado también en la configuración del webhook de Meta              |
| `WHATSAPP_GRAPH_VERSION`        | Versión explícita, inicialmente `v25.0`; revisar vigencia al desplegar                 |
| `REDIS_URL`                     | Worker; `rediss://` obligatorio fuera de localhost/127.0.0.1, con certificados válidos |
| `WHATSAPP_QUEUE_PREFIX`         | Igual entre réplicas del mismo entorno, distinto entre entornos que compartan Redis    |

Los tokens de acceso se ingresan únicamente en Canales a través de HTTPS y se guardan con AES-256-GCM, IV aleatorio y AAD de empresa/número. Respaldar la clave de cifrado en un gestor de secretos. Cambiarla sin recifrar vuelve ilegibles los tokens existentes. No usar `NEXT_PUBLIC_*`, no copiar secretos a este documento ni al chat. Redis contiene IDs de trabajo; cuerpos y tokens no se encolan.

## Operación local

```sh
npm ci
npm run setup:local
npm run services:up
npm run db:generate
npm run db:migrate
npm run dev
```

En otra terminal del mismo directorio:

```sh
npm run worker
```

Sin credenciales reales, Canales indica que falta configuración. No se agrega un número de muestra a la aplicación ni se simula una conexión exitosa. Para pruebas automatizadas: detener desarrollo, ejecutar `npm run build` y luego `npm test`. El runner inicia web y worker de recepción usando solo monzo_test, Mailpit y Redis DB 1 locales. El worker rechaza habilitar envíos reales contra una base llamada monzo_test.

## Preparación de Meta para este usuario

El usuario solo dispone de WhatsApp Business en el teléfono. Empezar con el número de prueba de Meta para conservar su operación actual.

1. Abrir `https://developers.facebook.com/apps/`, iniciar sesión con la cuenta de Facebook que administrará el negocio y completar el registro de desarrollador si lo pide.
2. Crear una app para el caso de uso de WhatsApp Business. Las opciones de la consola cambian: confirmar las opciones visibles antes de indicar una categoría inexistente.
3. Configurar WhatsApp y el portfolio comercial que solicite Meta. Obtener el número de prueba, Phone Number ID y WABA ID, y agregar/verificar el teléfono receptor de prueba.
4. Guardar el App Secret y los tokens por canales privados en el alojamiento correspondiente. Un token temporal sirve para la prueba inicial y caduca; para operación continua hace falta una credencial adecuada con permisos y acceso a la WABA, normalmente `whatsapp_business_management` y `whatsapp_business_messaging`.
5. Una vez desplegada esta fase, configurar la callback HTTPS `/api/webhooks/whatsapp`, ingresar el Verify Token y suscribirse al campo `messages`. Autorizar el número en Canales también suscribe la app a la WABA.
6. Enviar un mensaje desde el teléfono receptor autorizado al número de prueba. Comprobar recepción en MONZO, responder dentro de la ventana y verificar que el teléfono recibió el mensaje y los recibos actualizan su estado.

No desvincular, borrar ni migrar el WhatsApp Business actual para esta prueba. La conexión futura del número comercial debe evaluar disponibilidad de coexistencia, condiciones de Meta, propiedad y verificación del negocio. El flujo actual autoriza manualmente activos de una app; no implementa Embedded Signup ni acredita revisión de app para incorporar empresas externas.

## Publicación pendiente · opción con worker permanente

Lo siguiente corresponde únicamente a `WHATSAPP_PROCESSOR=bullmq`. Para el presupuesto gratuito del usuario se sigue la ruta QStash descrita arriba. Vercel ejecuta la web y el webhook, pero no aloja el proceso permanente de BullMQ. En modo BullMQ se necesita Redis accesible por TLS y un servicio permanente para el worker (por ejemplo un VPS o un proveedor con servicio de background worker). Elegir proveedor, región y costos con el usuario antes de contratar recursos. No se configuró uno en esta sesión. Un worker consultando cada tres segundos puede mantener Neon activo: revisar cuotas y costos del plan.

Orden de publicación:

1. Revisar las migraciones aditivas tercera y cuarta, empezando por `prisma/migrations/202610290003_whatsapp_inbox/migration.sql`, respaldos y destino. La base de producción tiene dos migraciones registradas según la verificación del usuario; no repetir el SQL inicial de Fase 2.
2. Aplicar la migración pendiente mediante `prisma migrate deploy` con credenciales privadas del destino. No usar `db push`, reset, ni registrar una migración sin haber ejecutado y comprobado su SQL. Si se usa el editor SQL de Neon, preparar previamente una entrega transaccional y el registro Prisma con checksum exacto; no pegar el archivo sin registrar su historial.
3. Configurar variables de web y worker con bases y secretos separados de Preview/Production. Conservar las variables de autenticación y SMTP ya existentes.
4. Desplegar web y worker de esta misma versión. El worker no necesita un servidor HTTP ni un puerto público. Permitir salida a PostgreSQL, Redis y `graph.facebook.com` y conservar TLS, CA y proxy del proveedor.
5. Configurar callback/suscripción en Meta, autorizar número y realizar la prueba bidireccional real. El estado de autorización del número y un heartbeat reciente no prueban entrega.
6. Verificar regresiones de login, empresa/equipo, aislamiento con dos cuentas y desconexión. Registrar evidencia y límites reales antes de dar la fase por publicada.

Construcción del worker en un equipo con Docker y acceso normal a los registros:

```sh
docker build -f Dockerfile.worker -t monzo-whatsapp-worker:phase3 .
```

Inyectar sus variables con el gestor de secretos del alojamiento, nunca al construir la imagen. Si el entorno usa una CA de proxy, pasarla mediante el secreto BuildKit `proxy_ca` y configurar la CA de ejecución con los mecanismos de la plataforma; nunca desactivar verificación de certificados. En este entorno administrado se usa el daemon local explícito y se conservan las credenciales del registro. La imagen ejecuta como usuario node y consulta el heartbeat con `workers/healthcheck.mjs`. Configurar reinicio del proceso y un margen de apagado de al menos 30 segundos.

## Estados, fallos y recuperación

QUEUED significa guardado, no enviado. SENDING significa reclamado por un único procesador. SENT exige ID de Meta; DELIVERED/READ llegan por webhook firmado. Un rechazo explícito produce FAILED. Una interrupción/timeout puede ocurrir después de que Meta acepte el mensaje: queda UNKNOWN, no se reenvía automáticamente y un recibo posterior puede reconciliarlo. Revisar en el teléfono/Meta antes de realizar un envío manual nuevo. No hay garantía de exactly-once frente a una API externa sin idempotencia de proveedor.

El worker vuelve a comprobar autorización, credencial y ventana antes de enviar; revocar acceso, desconectar o cerrar la ventana cancela pendientes. Una solicitud ya en vuelo no puede retirarse de Meta. Un rechazo de un token antiguo no invalida una credencial renovada durante el envío. Desconectar elimina el token local y cancela QUEUED; no desuscribe toda la WABA, ya que podría afectar otros números.

Si Meta rechaza explícitamente el destinatario con `131030`, un WA ID argentino de exactamente `549` + diez dígitos admite una segunda petición con `54` + los mismos diez dígitos. Se conserva el contacto original, el cuerpo y el identificador de correlación; no se cambian otros países ni números de otra longitud. La variante se intenta una sola vez después del rechazo: nunca tras aceptación, timeout, respuesta sin ID, error de servidor o cualquier otro código. Si esa variante falla, se conserva FAILED o UNKNOWN según la certeza del resultado, sin un tercer envío ni reenvío automático del mensaje anterior.

El webhook responde 503 si falla la persistencia para que Meta pueda reintentar. Redis/worker caídos dejan eventos en PostgreSQL; al volver, el dispatcher recupera pendientes. Una recepción fallida se intenta ocho veces con espera exponencial y después se muestra como error para revisión/reencolado por OWNER. Los payloads procesados se vacían. En modo BullMQ sus registros operativos se eliminan después de siete días; en QStash esos metadatos permanecen hasta una limpieza administrativa, sin conservar el cuerpo procesado; contactos, mensajes y notas no se borran automáticamente. Revisar los fallidos que todavía conservan contenido según la política de retención del negocio.

## Límites actuales

- Solo respuestas de texto dentro de 24 horas desde el último mensaje del cliente. Plantillas y conversaciones iniciadas por el negocio quedan pendientes.
- Se conservan tipo, ID y leyenda de medios recibidos; no se descargan archivos ni se habilitan adjuntos salientes.
- Actualización por polling de cuatro/cinco segundos; no WebSockets. Listas de contactos/conversaciones acotadas a 100, historial por páginas de 50, últimas 50 notas y primeros 100 números de una WABA durante autorización.
- No hay sincronización de historial previo, coexistencia implementada, Embedded Signup ni proceso de revisión de app para clientes externos.
- El usuario confirmó autorización real contra Meta y recepción en MONZO con el modo QStash de Vercel. Falta confirmar una respuesta de MONZO recibida en el teléfono. Las pruebas automatizadas de contratos usan transportes explícitos; no establecen entrega externa. No se configuró Redis remoto ni un alojamiento permanente.
- No hay IA, automatizaciones, CRM, cobros o analíticas operativas en esta entrega.
