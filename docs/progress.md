# Progreso de MONZO

Fecha: 30 de octubre de 2026.

## Fase 1 · Publicada

Landing Cloud, demo visual, recursos oficiales y fundación técnica completados. El código se subió a `amyndevelop/monzo`, commit `ea36ede`, y el usuario desplegó esa versión en Vercel: `https://monzo-v.vercel.app`. Las capturas del usuario confirmaron la landing y la demo funcionando con el logo y la mascota.

El logo se exportó del PDF vectorial a SVG sin redibujar o recolorear. Los dos PDFs originales se conservan en `assets/brand/originals/`; las 20 expresiones de la mascota conservan sus máscaras de transparencia. Los originales de la mascota tienen resolución limitada; no se generaron detalles artificiales.

## Fase 2 · Publicada; flujo principal confirmado en producción

Entrega integrada en `main` y subida a GitHub en el commit `1021164`. El usuario confirmó con capturas el correo de verificación recibido, el acceso a la cuenta verificada y la creación de una empresa con entrada al dashboard en `https://monzo-v.vercel.app`. La Fase 3 se desarrolla por separado, sin cambios en ese despliegue.

### Implementado

- Better Auth 1.7.14 con adaptador Prisma y transacciones habilitadas.
- Registro por correo/contraseña, correo verificado obligatorio, reenvío de verificación, inicio/cierre de sesión y recuperación.
- Sesiones persistentes sin cookie cache, cookies HttpOnly/SameSite y Secure para HTTPS. Revocación de sesiones al restablecer contraseña.
- Creación y selección real de empresas; cada creación asigna propietario en servidor.
- Configuración independiente de nombre, zona horaria e idioma.
- Roles OWNER, ADMIN y MEMBER, con permisos comprobados en servidor por solicitud.
- Equipo real, invitaciones por correo con caducidad y aceptación por destinatario verificado, cambio de roles y revocación.
- Protección del último propietario mediante bloqueo transaccional por empresa, incluyendo operaciones concurrentes.
- Demo pública en `/demo`; `/dashboard` exige sesión verificada y membresía actual.
- Protección de origen, validación estricta y límites persistentes de intentos en autenticación.
- Migraciones versionadas: fundación y autenticación/empresas, sin resets ni drops.
- PostgreSQL y SMTP de desarrollo con Docker Compose; bases separadas para desarrollo y pruebas.
- Secretos locales generados sin imprimirlos; `.env` y `.env.test` ignorados.
- README, arquitectura, roadmap, guía de Fase 2 y documento de seguridad actualizados.

### Validación ejecutada

| Comprobación           | Resultado                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `npm ci`               | Aprobado con el lockfile actualizado                                                                                  |
| `npm run setup:local`  | Aprobado y repetido, preservando configuración y secretos existentes                                                  |
| `npm run services:up`  | PostgreSQL de desarrollo, PostgreSQL de pruebas y Mailpit listos; repetido sin borrar volúmenes                       |
| `npm run db:generate`  | Prisma Client 6.19.3 generado                                                                                         |
| `npm run db:migrate`   | Dos migraciones aplicadas solo a monzo_dev; segunda ejecución sin pendientes                                          |
| Migración de pruebas   | Aplicada a la instancia independiente monzo_test; sin resets                                                          |
| `npm run db:validate`  | Esquema válido                                                                                                        |
| `npm run typecheck`    | Aprobado                                                                                                              |
| `npm run lint`         | Aprobado sin advertencias de lint                                                                                     |
| `npm run format:check` | Aprobado                                                                                                              |
| `npm run build`        | Aprobado; rutas privadas dinámicas, sitio y demo públicos                                                             |
| `npm test`             | 30/30 casos aprobados: escritorio y móvil, sobre PostgreSQL y SMTP locales                                            |
| Casos complementarios  | 4/4 aprobados en escritorio/móvil: selector entre empresas propias y reenvío de verificación sin revelar cuentas      |
| Arranque de desarrollo | HTTP 200 y contenido comprobado en sitio/demo/registro; dashboard anónimo redirige a login y API privada devuelve 401 |
| Revisión visual        | Registro, dashboard privado, preferencias y equipo revisados en capturas de escritorio/móvil                          |

Se probaron registro y verificación por SMTP, login y logout, creación de empresa y cambios de preferencias desde la UI. También cuentas sin verificar, passwords incorrectas, cookies inventadas, sesiones vencidas, recuperación con token de un uso y revocación de sesiones. Las pruebas de dominio incluyeron lectura/escritura y selección de empresas ajenas, IDs de membresía cruzados, escalamiento de rol, revocación, invitaciones ajenas/vencidas/reutilizadas y dos propietarios demoviéndose al mismo tiempo. El resultado concurrente fue una operación permitida y otra rechazada, conservando un propietario.

La suite también verifica landing, demo, imágenes, menús, favicon, 404 y cabeceras. Los errores registrados de contraseña incorrecta u origen inválido corresponden a casos negativos esperados. Las primeras comprobaciones de implementación detectaron un import de la demo y una regla de lint aplicada al nombre del fixture; se corrigieron antes de la suite aprobada, sin desactivar controles.

Las pruebas generan cuentas y empresas identificadas como pruebas exclusivamente en monzo_test. Mailpit captura los mensajes y no los entrega a Internet. Las APIs privadas se prueban con sesiones reales de la biblioteca; no se reemplazaron por mocks ni se simuló que Meta/OpenAI estuvieran conectados.

### Persistencia y publicación

Las instrucciones reutilizables `install_script` y `start_skill` se guardaron en el borrador del entorno para incluir PostgreSQL, Mailpit y el workflow de Fase 2. Guardar ese borrador no publica el entorno ni despliega Vercel. No se cambian membresía de repositorios, secretos o política de red para esta actualización. La restauración de esta fase en una instancia nueva todavía no fue verificada.

### Producción: evidencia y alcance de verificación

- Neon `monzo-db`, rama `main`, base `neondb`, conectada al proyecto Vercel `monzo-v`.
- El usuario ejecutó el SQL y confirmó una consulta de solo lectura con **10 tablas y 2 migraciones aplicadas** en neondb. No se usaron ni solicitaron credenciales de conexión en el chat.
- Resend muestra verificado `notificaciones.puntounodev.com.ar`. El usuario confirmó haber guardado la configuración SMTP en Vercel y el secreto de autenticación, con el origen `https://monzo-v.vercel.app`.
- La entrega se subió a GitHub y el usuario confirmó el flujo principal funcionando en el dominio público.
- Confirmado mediante capturas y reporte del usuario: registro real, entrega de correo externo, cuenta verificada, acceso por HTTPS y creación de empresa con entrada al dashboard.
- No comprobado en producción en esta sesión: flags de cookies, cierre de sesión, recuperación de contraseña, invitaciones y aislamiento con dos cuentas. Esos flujos y controles cuentan con pruebas locales descritas arriba.

Las credenciales de Vercel no se leyeron desde este entorno; su configuración fue realizada por el usuario. La entrega externa y el flujo principal sí fueron confirmados por el usuario. Las capturas de correo contienen enlaces sensibles: no se copiaron tokens, direcciones de verificación ni datos de cuenta a esta documentación. La verificación descrita corresponde a Fase 2. RLS, MFA, IA, automatizaciones, CRM, pagos y analíticas operativas siguen pendientes. La Fase 3 local se describe a continuación. Ver `docs/phase-2.md` y `docs/security.md`.

## Fase 3 · Implementada y validada localmente; conexión externa pendiente

Rama `feat/phase-3-whatsapp-inbox`, separada de la Fase 2 publicada. Webhook oficial firmado, autorización de números contra Meta, tokens cifrados, recepción durable e idempotente, contactos, bandeja responsive, respuestas de texto en ventana de 24 horas, estados, asignación, cierre y notas internas. Worker Node independiente con Redis/BullMQ y contenedor de producción. Alcance y operación en `docs/phase-3.md`.

### Validación local

- `npm ci` con lockfile, preparación local repetida, Prisma validate y tres migraciones locales sin pendientes; no se modificaron migraciones aplicadas.
- TypeScript, lint sin advertencias, formato y compilación de producción aprobados.
- Suite completa: **50/50 casos**, escritorio y móvil, con PostgreSQL, Mailpit, Redis y worker real de recepción. Incluye los flujos de Fase 2 y 20 casos de WhatsApp.
- Tras los últimos ajustes del dispatcher, dependencias y accesibilidad, se recompiló y se repitieron los **20/20 casos de WhatsApp**; aprobados. Formato, TypeScript y lint también aprobados.
- Firmas sobre bytes originales, desafío, cuerpo alterado, idempotencia, separación entre empresas, cursores, notas, asignaciones, ventana de 24 horas, revocación/desconexión, estados tardíos, resultados inciertos, concurrencia y rotación de token durante un envío.
- Se corrigieron reapertura en el mismo segundo del cierre y desplazamiento del menú móvil. Se comprobó paginación de 55 mensajes distribuidos en tres eventos durables y recepción demorada que no reabre un cierre posterior.
- Prueba adicional de interrupción controlada de Redis local: PostgreSQL conservó el evento, el worker real lo recuperó al volver Redis y repetirlo no duplicó mensajes. Solo base de pruebas; Redis quedó restaurado.
- Imagen `monzo-whatsapp-worker:phase3` construida. Arranque de dependencias de producción comprobado sin red, con usuario sin privilegios y sin `.env`/`.env.test` incluidos. La recepción completa se probó con el worker del host; el contenedor no se conectó a servicios remotos.
- Bandeja revisada visualmente en escritorio y móvil con datos identificados como pruebas. Los contratos y errores de Meta se verifican mediante transportes inyectados; no se enviaron credenciales ficticias al proveedor.

Las instrucciones `install_script` y `start_skill` se guardaron en el borrador del entorno, incluyendo Redis y el workflow del worker. Guardar el borrador no aplica ni publica el entorno. Se preservaron repositorios, requisitos y política de red existentes; `graph.facebook.com` todavía requiere habilitación para futuras llamadas desde este entorno. La restauración en una instancia nueva no fue probada.

### Pendiente externo

El usuario creó la app de Meta y confirmó recepción del mensaje de prueba enviado desde la consola del proveedor. También confirmó haber guardado WHATSAPP_APP_SECRET, WHATSAPP_ENCRYPTION_KEY y WHATSAPP_WEBHOOK_VERIFY_TOKEN en Vercel, sin compartir sus valores. Eso todavía no verifica el recorrido de MONZO. Solicitó una alternativa gratuita al worker alojado: se preparó QStash por eventos, descrito abajo. Su número comercial actual no se desvinculó ni migró.

No se hizo push de esta fase, no se migró Neon de producción ni se desplegó web/worker. No se afirma conexión real, entrega por WhatsApp, coexistencia, revisión comercial de la app ni funcionamiento de Redis remoto. IA, automatizaciones, CRM y cobros siguen pendientes.

## Ajuste de Fase 3 · Presupuesto gratuito

El usuario rechazó contratar un worker de pago. Se implementó `WHATSAPP_PROCESSOR=qstash` para Vercel + Upstash QStash, sin Redis ni proceso permanente en este modo. Se mantiene BullMQ como alternativa local/servidor propio. No se creó una cuenta, suscripción ni recurso de pago.

La cuarta migración agrega marcas de publicación en eventos y mensajes, sin alterar las tres anteriores. El webhook conserva datos antes de publicar y responde 503 si no obtiene aceptación de la cola. El envío idempotente conserva QUEUED ante fallos de publicación y permite reintentar la misma clave. QStash recibe solo IDs y los callbacks validan firma, URL y cuerpo originales mediante la biblioteca oficial. Un watchdog demorado y la recuperación por OWNER respetan UNKNOWN sin reenviar.

Validación específica: **14/14 casos aprobados** en escritorio/móvil, incluyendo callback HTTP real local, firmas actual/siguiente, cuerpo alterado, emisor/destino/caducidad, cuerpo acotado, fallos de publicación, duplicados concurrentes, recuperación autorizada y ventana de atención. Los transportes reales rechazan monzo_test: no se publicaron fixtures a QStash/Meta. Compilación, TypeScript y lint aprobados. Se consultaron los contratos oficiales publicados en el repositorio de documentación de Upstash; la página de precios quedó bloqueada por la política de salida del entorno.

La elegibilidad y cuota vigentes del plan Free deben confirmarse en el panel del usuario. No se promete gratuidad ilimitada ni se contratan recursos. Falta esa cuenta/configuración, aplicar las migraciones tercera y cuarta a producción, publicar esta fase y validar entrega bidireccional desde MONZO. El presupuesto gratuito es una restricción del usuario que debe conservarse en próximos pasos. Ver docs/phase-3.md.

La primera regresión completa tras el cambio se interrumpió por ENOSPC durante una construcción Docker paralela; no se atribuyó a un fallo de la aplicación. Se eliminaron únicamente tres imágenes antiguas del worker creadas en esta tarea y caché de construcción sin uso, conservando servicios, volúmenes y la imagen actual; quedaron aproximadamente 20 GiB libres. La imagen actualizada se construyó con npm ci y Prisma generado.

Verificación final tras liberar espacio: **50/50 casos de regresión aprobados**, además de **14/14 QStash** (64 comprobaciones aprobadas entre ambas suites). La imagen actualizada también pasó imports sin red como usuario no privilegiado y sin archivos de secretos. Formato, TypeScript, lint, esquema Prisma y build aprobados. El borrador del entorno conserva explícitamente la restricción gratuita y la ruta QStash; guardarlo no aplica ni publica cambios. No hubo push, migración de producción, despliegue ni contratación de servicios.

## Preparación de publicación · Variables confirmadas; Neon pendiente

El usuario mostró QStash con plan Free en las regiones EU y US; se indicó usar US Region. Confirmó haber guardado `WHATSAPP_PROCESSOR`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` y `QSTASH_URL` en Vercel Production. Las tres variables de Meta/cifrado ya habían sido confirmadas por el usuario. No se vieron sus valores ni se comprobó la conexión real; la cuota exacta no aparece en la captura.

Se prepararon `docs/sql/phase-3-upgrade.sql` y `docs/sql/phase-3-verify.sql` para actualizar la base existente sin repetir Fase 2. Un generador conserva los bytes/checksums de las migraciones 3 y 4. La prueba en una base temporal del contenedor local comprobó cuentas, empresas y membresías preservadas, rollback atómico, checksums, rechazo de historial incompatible/duplicado/parcial y repetición segura. No se conectó a Neon ni se modificó producción. Resultado esperado de la comprobación del usuario: `neondb | 7 | 4 | 2`. La publicación se realiza después de esa confirmación.

El usuario informó un bloque SQL incompleto y luego una referencia a WhatsappAccount inexistente. La consulta de solo lectura confirmó neondb/public con únicamente las nueve tablas de Fase 2 y _prisma_migrations; no se confirmó la aplicación de Fase 3. Se preparó una versión compacta para copiar desde un único bloque del chat, con la misma actualización protegida y una comprobación final. La variante compacta pasó las pruebas locales de actualización, datos preservados, rollback, historial y resultado neondb|7|4|2. No se editaron migraciones aplicadas ni se accedió a producción.

## Neon actualizado · Publicación del código en preparación

El usuario ejecutó el bloque compacto completo en monzo-db/main/neondb. Su captura muestra DO ejecutado correctamente y dos consultas; luego pegó el resultado **neondb | 7 | 4 | 2**: siete tablas WhatsApp, cuatro migraciones aplicadas y ambas columnas de publicación en cola. No hay transacción pendiente visible en la captura. No se usaron credenciales de producción desde este entorno.

Se prepara la integración/publicación en main para activar el despliegue automático de Vercel. Todavía no se afirma despliegue Ready, webhook de Meta configurado ni entrega real desde MONZO. Se conserva el presupuesto gratuito y la modalidad QStash.

## Código publicado · Canales visible en producción

La entrega se integró y subió a main en el commit `a3083f9`; el push y su SHA remoto fueron comprobados. Los 60 archivos de la entrega se contrastaron con los secretos locales y no incluyeron sus valores, archivos .env ni resultados de pruebas. Después el usuario mostró la nueva pantalla privada de Canales bajo su empresa en el dominio de producción. Eso confirma la pantalla nueva desplegada, aunque no se consultó el estado Ready directamente en el panel de Vercel ni se verificó todavía recepción/envío real con Meta/QStash.

La captura muestra un correo en el campo de ID empresarial y un valor oculto en el token, compatibles con autocompletado del navegador. Se ajustaron las indicaciones y atributos de autocompletado del formulario de credenciales para reducir la confusión con un login. El token continúa oculto y el servidor sigue exigiendo IDs numéricos y autorización real de Meta. El usuario debe sustituir los datos autocompletados por los identificadores y el token de Meta. Próximo paso externo: callback y suscripción messages, luego autorizar el número de prueba y validar ambos sentidos.

El ajuste del formulario pasó lint y compilación de producción, incluida la comprobación TypeScript. La validación con el perfil de Chrome del usuario y su gestor de credenciales sigue siendo una comprobación externa; los atributos reducen el autocompletado y no garantizan el comportamiento de todas las extensiones.

## Meta autorizado · Configuración QStash pendiente de corregir

El usuario mostró el webhook marcado como completo en Meta y luego la autorización exitosa del número de prueba desde MONZO: la UI confirmó número/suscripción y mostró la tarjeta Test Number autorizada. Eso verifica las llamadas de autorización contra Meta en producción; la entrega bidireccional todavía no está comprobada. La captura también muestra procesamiento pausado y un trabajo pendiente, por lo que la comprobación local de configuración QStash no pasa. No prueba una caída del proveedor.

El usuario compartió únicamente la URL pública de la región US, `https://qstash-us-east-1.upstash.io`, entre comillas. La documentación oficial de Upstash confirma esa dirección. Se indicó guardarla sin comillas; no se sabe si las comillas formaban parte del valor en Vercel o solo del mensaje. No se solicitaron tokens o claves.

Se añadió diagnóstico en Canales que comunica al OWNER solamente nombres de variables faltantes o de URL/origen con formato inválido. No devuelve valores ni expone esos detalles a MEMBER. La comprobación sigue distinguiendo configuración de disponibilidad/entrega real. Tras corregir variables y volver a desplegar, recuperar pendientes desde la UI antes de validar recepción y respuesta.

También se normalizan espacios y un par de comillas exteriores en la URL pública de QStash, para admitir valores copiados desde ejemplos .env. Se mantienen HTTPS, host oficial, ruta base, ausencia de credenciales/redirecciones y validación TLS. No se modifican tokens ni claves. La prueba del contrato verifica la región US entre comillas y sigue rechazando una ruta /v2/publish o un host ajeno.

El usuario confirmó haber actualizado todas las variables sin comillas. El siguiente despliegue debe tomar esos valores; no se verificaron directamente. El ajuste pasó lint, compilación con TypeScript y los 16 casos de QStash (incluido diagnóstico privado y URL US normalizada). Después del despliegue, confirmar que se habilitó el procesamiento, recuperar pendientes y probar recepción/respuesta reales. No volver a autorizar o desconectar el número si la autorización actual sigue válida.

## Recepción real confirmada · Variante argentina del destinatario de prueba

Después del ajuste de QStash `99d7025`, el usuario confirmó mensajes reales visibles en la bandeja de MONZO. El primer envío falló con META_190 y, tras renovar el token temporal, con META_131030. La plantilla enviada desde la consola de Meta sí llegó al mismo teléfono. El usuario y su captura confirman que el destinatario autorizado por Meta usa `54` + número nacional, mientras MONZO recibe el WA ID argentino `549` + ese número. No se almacenaron en estos documentos el teléfono real ni el token visible en la captura. Se indicó renovar esa credencial y sustituirla en Canales.

Se añade una variante de envío limitada a un rechazo explícito 131030 para WA IDs argentinos de trece dígitos: una sola petición adicional con `54` + los diez dígitos nacionales. Se conserva el contacto y la correlación del mensaje. No se reintentan aceptaciones, resultados inciertos, errores de servidor, credenciales u otros destinatarios. El mensaje fallido anterior permanece como tal; la prueba externa debe usar un mensaje nuevo tras desplegar el ajuste. El recorrido saliente real continúa pendiente de confirmación.

Validación del ajuste: lint y compilación de producción con TypeScript aprobados; **28/28 casos** de contratos de Meta y QStash aprobados en escritorio/móvil, con la base local aislada. Incluyen aceptación original, variante después de rechazo, otros países/longitudes, credencial/ventana, timeout, respuesta sin ID, servidor 500, segundo fallo sin tercer envío y callbacks concurrentes/repetidos sin duplicar ni cambiar el contacto. Formato y diff comprobados. No se ejecutaron llamadas de envío reales desde este entorno ni se modificó el esquema de producción.

## Texto en producción confirmado · Token de usuario del sistema

Tras publicar `5021ec3`, el usuario confirmó que la respuesta de MONZO llegó al teléfono: recepción y envío de texto con Meta y QStash reales. Luego creó un usuario del sistema, asignó la app y la cuenta de prueba, generó un token, lo sustituyó en Canales y confirmó funcionamiento. No se leyó esa credencial ni se verificó si eligió vencimiento Nunca. No se modificó ni migró su número comercial.

## Fase 4 · Adjuntos desarrollados; migración de producción pendiente

El usuario pidió continuar la siguiente fase de desarrollo después de revisar que adjuntos, plantillas e IA todavía estaban pendientes. Se implementaron adjuntos en la rama `feat/phase-4-whatsapp-media`: apertura a pedido de imágenes/stickers, reproducción de audio/video y descarga de documentos; envío de un archivo por respuesta mediante la cola actual. Límite de 3 MiB, contenido detectado por bytes, leyendas de hasta 1024 caracteres salvo audio, nombres saneados, carga/descarga por Meta y acceso por empresa sin URLs temporales o tokens en DTOs. No se contrataron servicios ni agregaron variables. Plantillas, transcripción, grabación, IA y alta comercial siguen pendientes.

La quinta migración agrega cuatro columnas nulas a Message. Se aplicó únicamente a monzo_dev y monzo_test locales. La actualización protegida para Neon está en `docs/sql/phase-4-upgrade.sql`, generada desde la migración con su checksum exacto; su verificación debe devolver **neondb | 4 | 5**. La prueba sobre una base temporal del contenedor test-database confirmó conservación de usuario/empresa/mensaje, rollback forzado después del DDL, checksum, rechazo de destino/historial/esquema incorrectos y repetición segura. No se modificaron migraciones previas ni se conectó a producción. El código de Fase 3 publicado admite estas columnas adicionales; no se debe publicar el nuevo cliente antes de aplicarlas.

Validación: compilación de producción con TypeScript, Prisma validate, lint, formato y diff aprobados. La suite general pasó **84/84** casos con PostgreSQL/Mailpit/Redis y worker de recepción local. Después de completar rangos y descarga del navegador se ejecutó el conjunto final de adjuntos/QStash: **44/44** aprobados en escritorio/móvil, incluyendo reproducción con readyState válido, descarga con nombre esperado, errores y formulario conservado al fallar. Esos conjuntos comparten casos; no se suman como casos únicos. La recepción de metadatos y el DTO privado pasaron además **2/2** comprobaciones adicionales tras cerrar la selección mínima de campos públicos. La revisión visual de capturas confirmó ausencia de desborde en escritorio/móvil. No se presenta ninguna de esas pruebas como envío externo real de adjuntos: los contratos usan transportes explícitos y la UI intercepta solo los archivos de fixtures; el servidor real bloquea la red de Meta contra monzo_test.

El código está preparado para revisión y publicación después de que el usuario aplique el SQL de Fase 4 y confirme la fila final. Falta comprobar archivos entrantes y salientes con Meta real tras el despliegue. La operación de texto actualmente publicada continúa vigente. Alcance, permisos, retención y pasos de prueba en `docs/phase-4.md`.

## Neon Fase 4 confirmado · Código integrado para publicación

El usuario ejecutó la consulta nueva y compartió el resultado **neondb | 4 | 5**: cuatro columnas de adjuntos y cinco migraciones aplicadas. Esto confirma la actualización requerida para publicar el cliente Prisma de Fase 4. No se usaron credenciales de Neon desde este entorno.

La implementación `163d086` se integró por fast-forward en main, manteniendo las verificaciones ya registradas. Se prepara el push para activar Vercel. La compilación y pruebas de esta entrega ya estaban aprobadas; esta actualización solo registra la evidencia externa y la publicación, sin cambios de comportamiento. Pendiente externo: estado Ready y recorrido de una imagen/audio/documento entre el teléfono y MONZO.

## Adjuntos reales confirmados · Presentación de chat renovada

El usuario confirmó que Fase 4 funciona en producción y compartió una captura de imagen y audio. Pidió suavizar los bloques y el botón de adjuntar, tomando WhatsApp como referencia. Se renovaron las burbujas y el fondo, imágenes integradas con vista ampliada, documentos compactos y audio con reproducción/pausa, posición y velocidad. El gráfico de audio es decorativo; tiempos y posición provienen del archivo real. La barra de escritura usa clip y envío circulares, crece al escribir y muestra una vista previa removible del adjunto. Enter envía en escritorio y Shift+Enter agrega una línea; en pantallas táctiles Enter conserva el salto. La carga de medios sigue siendo a pedido.

Validación: lint, TypeScript, compilación y formato aprobados. **48/48** casos de WhatsApp/adjuntos en escritorio y móvil; controles de audio y diálogo con Escape incluidos. Después se ampliaron las comprobaciones de teclado y se aprobaron los **4/4** casos de bandeja seleccionados, verificando Enter, Shift+Enter, descarga y conservación del borrador/archivo ante un fallo de proveedor. Capturas de ambos tamaños revisadas, sin desborde horizontal. Son pruebas locales con archivos de fixture y transportes explícitos; no se afirma validación del rediseño en el navegador real del usuario.

Este ajuste no requiere migraciones, tokens ni servicios adicionales. Se prepara la publicación del cambio visual sobre el esquema de producción ya confirmado.
