# Fase 5 · Plantillas de WhatsApp

Implementación `932a890`, integrada para despliegue desde main tras la confirmación del usuario de **neondb | 1 | 2 | 4 | 6**. La sexta migración de Neon ya fue confirmada por el usuario; no se consultó la base desde este entorno. Pendiente confirmar Ready de Vercel y sincronización/envío con Meta real. No se afirma entrega externa a partir de los contratos locales.

## Recorrido y UX/UI

Desde el compositor, el icono de plantilla abre un diálogo dentro de la bandeja. Cuando la ventana de 24 horas está cerrada aparece la acción «Elegir plantilla». La bandeja conserva pantalla completa, menú plegable, historial con scroll propio y borrador de respuesta. El diálogo usa dos paneles en escritorio y lista/detalle con retorno en móvil; búsqueda, filtros por idioma/estado, vista previa, campos, errores y acción final quedan dentro del viewport.

El catálogo se lee de la base sin consultar automáticamente a Meta. Owner/Admin pueden usar Actualizar y Traer más plantillas; los integrantes pueden consultar y enviar. Cada consulta trae hasta 50 plantillas; el listado local también pagina de a 50. La actualización completa marca como no disponibles las plantillas desaparecidas. Una actualización parcial conserva las restantes hasta completar el catálogo. La fecha mostrada corresponde a la última actualización completa.

Las variables muestran su ejemplo como ayuda, sin completar datos ficticios del cliente. La vista previa muestra encabezado, texto, pie, botones, idioma y categoría. Los campos obligatorios y límites impiden un envío incompleto. El pie comunica posibles cargos de Meta; no se contrata un servicio ni se fija un precio desde MONZO. El botón Enviar plantilla guarda un envío en cola: el historial informa En cola/Enviando/Enviado/Entregado/Leído, o el error real. Guardar no equivale a entregar.

Los datos, archivo y clave de envío se conservan ante errores para poder reintentar sin duplicar el mensaje. El selector no borra el texto normal escrito en el chat. Un cambio de definición detectado al revisar el catálogo exige completar la nueva versión. Escape, cierre y retorno del foco están contemplados; durante una petición de envío/actualización no se cierra el diálogo. El usuario estableció UX/UI como requisito permanente; se registró en AGENTS.md fuera del bloque generado por Next.

## Alcance

- Plantillas ya creadas en Meta, de utilidad y marketing, aprobadas para envío individual a un contacto existente. Aprobadas/pausadas/rechazadas/en revisión se muestran con su estado.
- Texto estático, variables numeradas o con nombre, encabezados de texto, imagen JPEG/PNG, video MP4/3GP o PDF de hasta 3 MiB; pie y botones URL, teléfono y respuesta rápida. URL dinámica admite un sufijo variable.
- Encabezados de archivos usan la carga y descarga privada de Fase 4. Meta conserva el medio; no se añade bucket ni se guardan sus bytes o URLs temporales en PostgreSQL.
- Respuestas a botones e interacciones entrantes muestran el título recibido en el chat.

Creación/edición/aprobación de plantillas se realiza en Meta. Autenticación OTP, carruseles, Flows, ubicación y botones especiales quedan en modo de consulta con una explicación. No se agregó Embedded Signup, onboarding comercial de terceros, campañas masivas, programación comercial, migración de número ni IA. No se cambia el número real de WhatsApp Business. No hay nuevos secretos, servicios o dependencias de pago. Las reglas, cuotas, permisos y cargos vigentes de Meta siguen aplicándose; el número de prueba mantiene sus restricciones.

## Integridad y permisos

`WhatsappTemplate` queda vinculada a tenant y cuenta por claves compuestas, además de WABA y providerId. Solo se consultan las plantillas de la cuenta de la conversación autorizada. Los DTOs no exponen tokens ni identificadores de medios. El esquema de parámetros es estricto y el destinatario proviene del contacto existente, nunca del cuerpo de la solicitud. Las mutaciones exigen origen exacto y sesión verificada. Los formularios de archivo autorizan antes de leer bytes y tienen límite total de 3 MiB + 32 KiB.

La sincronización usa un endpoint fijo de Graph y un cursor validado/codificado. Nunca sigue la URL `paging.next` devuelta por el proveedor. Límites de 5 consultas de catálogo por empresa/minuto, 10 cargas y 30 mensajes salientes; las llamadas son explícitas y acotadas. El bloqueo de empresa protege las escrituras, no se mantiene durante HTTP. Se revalidan rol, canal, WABA, credencial y versión de sincronización después de la consulta.

El mensaje guarda una instantánea inmutable de definición, variables, hash, categoría, idioma y medio. Cambiar la plantilla del catálogo no reescribe el historial. La clave idempotente compara el contenido canónico, archivo y conversación; un replay usa la instantánea original aunque haya cambiado el catálogo. Peticiones simultáneas pueden producir un archivo remoto sobrante, pero un único Message.

El worker consulta el estado/definición actual en Meta antes de reclamar el envío. Una pausa o cambio de definición/categoría impide el POST y actualiza el catálogo sin sobrescribir una sincronización posterior. Luego revalida membresía, canal, credencial y caché bajo bloqueo antes de pasar QUEUED a SENDING. Las plantillas pueden enviarse fuera de las 24 horas; texto libre y adjuntos conservan su ventana. QStash/BullMQ usan solo el ID del mensaje. Los envíos inciertos quedan UNKNOWN y no se reintentan automáticamente. Se mantienen recibos monotónicos, guardas de rotación de credenciales y variante argentina exclusivamente ante rechazo explícito 131030.

## Actualización y publicación

La migración aditiva `202610300002_whatsapp_templates` crea WhatsappTemplate, agrega cuatro campos de catálogo a WhatsappAccount y dos campos nulos de plantilla a Message. No modifica migraciones anteriores ni elimina registros. El código actual de producción admite estas adiciones; el nuevo cliente Prisma necesita la migración antes de desplegarse.

1. Ejecutar `node scripts/prepare-phase-5-sql.mjs` para reproducir `docs/sql/phase-5-upgrade.sql` desde el DDL versionado y checksums exactos.
2. En Neon, `monzo-db / main / neondb`, abrir una consulta nueva y ejecutar **todo** ese archivo. No repetir los SQL de fases anteriores. El DO aplica DDL e historial dentro de una sola transacción; rechaza destino, historial y esquema incompatibles. Si ya está aplicada correctamente, no modifica datos.
3. Confirmar la fila **neondb | 1 | 2 | 4 | 6**: base, tabla de plantillas, columnas de mensajes, columnas de catálogo, migraciones. `docs/sql/phase-5-verify.sql` permite repetir solo la comprobación.
4. Tras ese resultado, integrar la rama y publicar main. No agregar variables. Esperar Ready de Vercel y probar con el número de prueba de Meta.
5. Abrir una conversación, pulsar Usar plantilla → Actualizar; elegir una aprobada, completar datos y comprobar vista previa, teléfono y recibos. Si Meta exige permisos, revisar `whatsapp_business_management` y `whatsapp_business_messaging` y la asignación de su WABA al usuario del sistema sin compartir el token. La carga de plantillas se limita a la WABA del canal.

`scripts/test-phase-5-sql.mjs` usa una base temporal neondb exclusivamente dentro del contenedor local test-database, comprobando conservación de usuario/empresa/mensaje, rollback forzado después del DDL, checksums, repetición segura, claves foráneas y rechazo de esquema/destino/historial incorrectos. No se conecta a Neon.

## Verificación

`tests/templates.spec.ts` cubre paginación/cursor, aislamiento, permisos y cambios durante HTTP; variables/formatos especiales; envío fuera de ventana, idempotencia y concurrencia; payloads y comprobación previa con Meta mediante transportes explícitos; pausas/cambios de definición, resultados inciertos y revocación; encabezados privados y recuperación/foco/layout de la UI en escritorio/móvil. Las pruebas de API/UI usan sesión real y PostgreSQL local. La entrega real por Meta se verifica después del despliegue. Resultados finales en `docs/progress.md`.

## Diagnóstico de renovación de autorización (30 de octubre de 2026)

La renovación consulta `WABA/phone_numbers` y después solicita `WABA/subscribed_apps`.
Solo guarda el token cifrado y limpia `lastErrorCode` cuando ambas operaciones terminan
correctamente. Por eso un META_100 durante una renovación puede coexistir con el
META_190 anterior: el token nuevo no llegó a guardarse. META_100 por sí solo no prueba
caducidad ni permite identificar qué permiso o parámetro rechazó Meta.

Los errores ahora identifican la etapa que falló y aclaran que la conexión anterior
conserva su estado. No se devuelve el mensaje libre de Meta, que podría contener
información sensible. Canales muestra «Requiere autorización» para META_190 en vez de
«Número autorizado». El catálogo explica de forma visible por qué se bloquea la
actualización y el envío, y distingue el permiso de administrador del estado del canal.
El formulario conserva los datos ante un rechazo; el token sigue siendo un campo de
contraseña y solo se borra tras el éxito. Si el token ya no puede copiarse desde Meta,
hay que generar otro y completar la autorización. No se recupera ni se muestra la
credencial cifrada existente.

Este cambio no requiere migraciones. La causa concreta del META_100 reportado queda
pendiente de una nueva solicitud autorizada: los errores históricos no conservaron la
etapa. Los IDs informados son Phone Number ID 1309498698924805 y WABA ID
1171915459097699; no se incluyen como valores predeterminados para otros tenants.

### Comprobar la credencial existente

Canales incorpora «Comprobar autorización guardada» para propietarios de canales
habilitados. El POST exige sesión, rol OWNER y origen exacto; tiene límite de cinco
comprobaciones por empresa/minuto. Descifra exclusivamente en el servidor y ejecuta
GET de números y plantillas en Meta. No devuelve tokens, mensajes libres de Meta ni
respuestas del proveedor. No suscribe apps, envía mensajes ni publica trabajos.

Solo elimina lastErrorCode cuando ambas lecturas tienen éxito. La escritura compara
tenant, credencial, WABA, estado habilitado y error previo para no pisar una rotación o
desconexión concurrente. META_190 confirmado marca solo esa versión de credencial;
otros fallos mantienen el bloqueo. Un error de descifrado se informa como problema de
configuración de MONZO y no como rechazo de Meta. El éxito comprueba esas lecturas,
no la entrega de mensajes, el permiso de envío ni la suscripción de webhooks.

La UI explica que quitar el bloqueo puede permitir que el procesador continúe los
trabajos pendientes. El resultado aparece junto al canal mediante status/alert; el
botón conserva foco y muestra carga mientras se deshabilitan acciones simultáneas.
No requiere migraciones. tests/authorization.spec.ts cubre recuperación, aislamiento,
rotación, rechazo en ambas consultas, fallos de red, descifrado y ausencia del número.
