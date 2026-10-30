# Fase 4 · Adjuntos de WhatsApp

Estado: implementada en `163d086` e integrada en `main` para publicación. El usuario ejecutó el SQL de Fase 4 y confirmó **neondb | 4 | 5**. La migración de producción quedó verificada por ese resultado; falta comprobar Ready en Vercel y adjuntos reales. Fase 3 ya está funcionando en producción: el usuario confirmó recepción y respuesta real y luego sustituyó el token temporal por un token de usuario del sistema. No se leyó la credencial ni se verificó su fecha de vencimiento desde este entorno.

## Alcance

- Abrir imágenes y stickers recibidos, reproducir audio/video y descargar documentos desde cada mensaje. Los archivos se cargan a pedido, no en cada actualización del historial.
- Adjuntar un archivo por respuesta dentro de la ventana de 24 horas. Imágenes JPEG/PNG; audio MP3, AAC, M4A y OGG con Opus; video MP4/3GP; documentos PDF, TXT UTF-8, DOCX, XLSX y PPTX. Los stickers WebP solo se reciben en esta entrega.
- Límite de **3 MiB por archivo** para subidas y descargas. El cuerpo multipart admite ese tamaño más 32 KiB de campos/cabeceras, por debajo del límite de las funciones de Vercel. Los archivos mayores recibidos por WhatsApp muestran un error explícito al intentar abrirlos.
- Leyendas de hasta 1024 caracteres en imágenes, video y documentos. Audio sin leyenda; el texto se envía en un mensaje separado. La selección de audio conserva un texto ya escrito y solicita enviarlo o quitarlo antes de adjuntar.
- Nombres, MIME, tamaño y SHA-256 persistidos en Message. Los mensajes anteriores siguen funcionando con estas columnas nulas; al abrir un archivo se consulta su metadato actual en Meta.
- Envíos por el mismo procesamiento QStash/BullMQ, ventana, membresía, autorización de cuenta y estados de Fase 3. La variante argentina tras rechazo explícito 131030 se conserva también para medios. Nunca se repite un envío incierto.

No se agrega un bucket, proveedor, secreto o suscripción. Meta conserva los archivos según su política y el token debe seguir autorizado para descargarlos. MONZO pide una URL nueva al abrirlos; no guarda la URL temporal ni promete un archivo histórico permanente. Siguen rigiendo las cuotas de Vercel/Neon/QStash y las condiciones de Meta. No se agregó generación de plantillas, transcripción, grabación de micrófono, conversión de códecs ni agente IA. La reproducción depende también del navegador; se ofrece descarga cuando no puede reproducir el formato.

## Acceso y transporte

`POST /api/workspaces/:tenantId/conversations/:conversationId/attachments` exige sesión verificada, membresía, conversación de esa empresa, origen exacto y multipart. Autoriza antes de leer el cuerpo; cuenta bytes del stream, incluso sin Content-Length; rechaza campos repetidos/desconocidos, archivos vacíos y formatos no admitidos. La detección usa el contenido con `file-type` 22.3.0, no la extensión ni el MIME enviado por el navegador. Los TXT se validan como UTF-8 sin controles binarios. Esto no equivale a un antivirus ni a una validación de todos los códecs del contenedor; Meta puede rechazar un archivo y el estado reflejará su error.

Los archivos se suben directamente al endpoint fijo `/{phone_number_id}/media` de Graph. No se mantienen bytes en PostgreSQL, disco público ni cola. La cola contiene únicamente el ID del mensaje. Durante una subida no se mantiene un bloqueo de base: después se revalidan membresía, canal y ventana antes de crear el mensaje. La idempotencia compara empresa, conversación, tipo, hash, nombre y leyenda; peticiones concurrentes pueden subir un archivo sobrante a Meta, pero crean un solo mensaje saliente. Un archivo subido que no llegue a asociarse por revocación/fallo queda sujeto a la retención de Meta; no hay eliminación remota automática en esta entrega. Repetir un mensaje ya guardado no vuelve a subirlo.

`GET /api/workspaces/:tenantId/messages/:messageId/attachment` obtiene el ID únicamente del mensaje autorizado. La consulta de metadatos incluye el Phone Number ID de su cuenta. Solo se descarga por HTTPS desde `lookaside.fbsbx.com/whatsapp_business/attachments/`, sin credenciales en URL, puertos ajenos o redirecciones. Se preservan TLS, proxy y timeout. Se comprueba tamaño declarado/real, tipo detectado y hashes disponibles antes de entregar bytes. Un acceso revocado o canal desconectado durante la descarga impide entregar la respuesta.

Los DTOs no incluyen tokens, URLs temporales ni ID de medio de Meta. El navegador recibe `hasMedia` y metadatos. Las respuestas binarias tienen `private, no-store`, `nosniff`, CSP restrictiva y CORP same-origin; documentos como descarga y medios compatibles inline. Se admiten rangos de un solo segmento para reproductores. La UI usa object URLs locales liberadas al desmontar y cancela la descarga al cambiar de conversación.

Límites por empresa/minuto: 10 subidas nuevas, 60 descargas y el límite existente de 30 mensajes salientes. Se comparten en PostgreSQL y se actualizan bajo bloqueo de empresa. Una clave de envío nueva puede causar otra subida: al reintentar un error de programación se conserva la misma clave y archivo. No se cambia la clave de cifrado del token.

## Migración y publicación

La migración `202610300001_whatsapp_media` agrega cuatro columnas nulas a Message: `mediaMimeType`, `mediaFilename`, `mediaSize` y `mediaSha256`. No cambia las cuatro migraciones previas ni borra filas. El código publicado de Fase 3 es compatible con esas columnas adicionales. El nuevo cliente Prisma requiere aplicarlas **antes** de publicar la Fase 4.

1. Generar/revisar `docs/sql/phase-4-upgrade.sql` con `node scripts/prepare-phase-4-sql.mjs`.
2. En Neon `monzo-db / main / neondb`, ejecutar **todo** ese archivo en una consulta nueva. El bloque DO aplica la migración y registra su checksum exacto dentro de la misma transacción; no repetir el SQL de Fase 2 o 3.
3. Comprobar la fila final **neondb | 4 | 5**: base, columnas de adjuntos y migraciones aplicadas. Se puede repetir solo `docs/sql/phase-4-verify.sql`. El upgrade verifica historial previo, checksum, duplicados, columnas sin historial y tipos; si ya se aplicó correctamente no hace cambios.
4. Tras confirmar ese resultado, integrar/publicar la rama y esperar Ready en Vercel. No hacen falta nuevas variables.
5. Probar con el número de Meta: imagen y nota de voz entrantes; abrirlas en MONZO; adjuntar una imagen y un PDF de menos de 3 MiB con una leyenda y comprobar teléfono y recibos. Comprobar un archivo vencido/mayor y acceso tras revocar una membresía. No migrar ni desvincular el número comercial para esta prueba.

`node scripts/test-phase-4-sql.mjs` comprueba la actualización exclusivamente en una base temporal del contenedor test-database local, preservando usuario, empresa y mensaje; incluye rollback forzado después del DDL, checksums, historial incorrecto, esquema incompatible y repetición segura. No usa credenciales ni conexiones de Neon.

## Verificación

`tests/media.spec.ts` cubre formatos con fixtures reales de audio/video, límites, hash, URL/host de descarga, multipart, concurrencia, idempotencia, revocación durante HTTP, aislamiento entre empresas, payloads de Meta, variante argentina, carga a pedido, descargas y reproducción en escritorio/móvil. La API real rechaza red externa en monzo_test; los contratos positivos de Meta usan transportes explícitos, y la UI recibe archivos de fixtures mediante una ruta interceptada identificada en la prueba. No se presentan esas pruebas como entrega real externa de adjuntos.

Ejecutar `npm run build`, `npm test` y `npm run test:qstash`. Las pruebas de Fase 3 y autenticación continúan activas. Los resultados finales de esta entrega se registran en `docs/progress.md`. El usuario confirmó la migración de producción con neondb | 4 | 5; todavía no confirmó envío/descarga de adjuntos reales.
