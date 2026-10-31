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

## Conversaciones a pantalla completa · Menú plegable

El usuario pidió retirar el espacio superior y el scroll de página en Conversaciones, conservando un menú izquierdo que se pueda ocultar. Esa ruta ahora omite encabezado de cuenta, título visual y pie de página; conserva un h1 accesible. El contenedor ocupa 100dvh sin márgenes ni altura mínima heredada. Historial y lista tienen desplazamiento propio y el compositor permanece dentro del viewport.

La navegación se puede ocultar/restaurar en escritorio sin desmontar la bandeja ni perder el borrador. En móvil abre un panel superpuesto con Escape, foco contenido/restaurado y fondo inerte. Controles disponibles en la lista y en el hilo seleccionado. Empresa activa y cierre de sesión quedan en el menú. El estado plegado se conserva durante navegación cliente, pero no se persiste tras recargar. Las demás páginas mantienen encabezado, contenido y pie habituales; no se cambió autenticación ni acceso a datos.

Validación: lint y compilación con TypeScript aprobados. **4/4** pruebas nuevas de layout: alto y ancho de viewport, historial largo con scroll interno, compositor visible, plegado con borrador, menú móvil, regreso del foco y navegación hacia/desde otras secciones. Incluyen portátil 1366×642, tableta 820×600, móvil con altura reducida y orientación horizontal 844×390. **8/8** regresiones de registro/login/logout, selector de empresa, mensajes/notas y adjuntos aprobadas en escritorio/móvil. Capturas del chat completo y su compositor revisadas en ambos formatos. Sin migraciones ni variables nuevas. Pendiente externo: confirmar el nuevo despliegue en Vercel y su presentación en el navegador del usuario.

## Fase 5 · Plantillas desarrolladas con UX/UI desde el inicio

El usuario autorizó continuar con Fase 5 y pidió considerar UX/UI en cada proceso. Se registró como instrucción permanente en AGENTS.md. Rama `feat/phase-5-whatsapp-templates`, basada en `fad27e0`; main conserva la versión publicada confirmada por el usuario. No se publica el nuevo cliente Prisma hasta confirmar la sexta migración de Neon.

Se implementó catálogo de plantillas por cuenta/empresa/WABA, sincronización explícita de Meta paginada y limitada, búsqueda/idioma/estado y permisos de actualización Owner/Admin. El selector vive dentro del chat: lista/detalle adaptable, variables numeradas o con nombre, vista previa con texto/pie/botones y encabezados de imagen/video/PDF hasta 3 MiB. Estados no aprobados y formatos especiales se explican sin habilitar envío. Fuera de las 24 horas hay una acción para elegir una plantilla; las respuestas normales mantienen su ventana. Se conservan borrador, datos, archivo y clave idempotente ante fallos. Mensajes en el historial mantienen su instantánea original. El diálogo contempla foco, Escape, regreso a lista, scroll interno y acción final visible; el selector de archivo usa un control compacto con nombre real para evitar el «sin archivo» nativo después de seleccionar.

El worker comprueba estado y definición actual en Meta antes de reclamar, revalida miembro/canal/credencial/hash y usa la cola/transporte existentes. Pausas o cambios impiden el POST y actualizan el catálogo protegido contra escrituras obsoletas. La categoría forma parte de la definición validada. Los resultados inciertos no se reenvían automáticamente. Los DTOs y colas no exponen credenciales o bytes de archivo. Se muestran respuestas entrantes a botones. No se agrega proveedor, bucket, secreto ni suscripción; los cargos y requisitos propios de Meta continúan aplicándose. No se implementó onboarding comercial de terceros ni se migró el número comercial.

Validación: TypeScript, lint, formato y compilación aprobados. **120/120** pruebas generales en escritorio y móvil, incluidas **28** de plantillas y regresiones de acceso, empresas, texto, adjuntos y layout. Tras ajustar el control de archivo se repitieron los **6/6** recorridos UX de plantillas: vista previa, error/reintento con misma clave, archivo conservado, envío guardado y presentado en el historial, borrador preservado, foco y acceso desde ventana cerrada. Capturas de escritorio/móvil revisadas. Contratos de Meta con transportes explícitos y archivos de fixture; no se hicieron envíos externos ni se afirma prueba real en Meta.

La migración `202610300002_whatsapp_templates` agrega una tabla, dos campos de Message y cuatro de WhatsappAccount sin cambiar migraciones anteriores. Aplicada únicamente en monzo_dev/monzo_test locales; comparación de esquema sin diferencias. SQL de Neon generado desde el DDL y checksums exactos. Su prueba en base temporal local confirmó conservación de usuario/empresa/mensaje e historial, rollback forzado después del DDL, referencias compuestas, rechazo de esquema/historial/destino incompatibles y repetición segura. El resultado requerido de producción es **neondb | 1 | 2 | 4 | 6**; no se conectó a Neon. Alcance, límites, publicación y comprobación real pendiente en `docs/phase-5.md`.

Cierre de verificación: **18/18** regresiones de QStash aprobadas con el cliente final; **138 casos únicos** entre suite general y QStash. Compilación final y validación de Prisma aprobadas; formato y diff sin errores. La sexta migración todavía requiere ejecución/confirmación del usuario en Neon antes de integrar/publicar main. No se solicitaron ni leyeron credenciales de producción.

## Neon Fase 5 confirmado · Integración para despliegue

El usuario compartió **neondb | 1 | 2 | 4 | 6**: tabla de plantillas, dos columnas de mensajes, cuatro de catálogo y seis migraciones. Esto confirma la actualización de producción necesaria para publicar el cliente Prisma de Fase 5. No se accedió a Neon ni se solicitaron credenciales.

La implementación `932a890` se integra en main para activar el despliegue automático existente de Vercel. Se mantienen las verificaciones locales previas: 120 pruebas generales, 18 de QStash y repetición de 6 recorridos UX tras el ajuste del selector de archivos. Esta integración solo actualiza el estado documental; no modifica código ni esquema. Pendientes externos: confirmar Ready del despliegue correspondiente, abrir el selector de plantillas en la conversación de prueba, actualizar el catálogo desde Meta y comprobar una plantilla aprobada en el teléfono y sus recibos. No se afirma Ready ni envío real desde este entorno.

## Fase 5 confirmada en producción · Autorización de Meta resuelta

El usuario confirmó catálogo actualizado (cinco plantillas visibles) y envío real
correcto. Los diagnósticos localizaron META_100/33 en el acceso a la WABA: el usuario
del sistema tenía acceso a Test WhatsApp Account, pero no figuraba asignado a Test
Messaging Account, el activo con el WABA ID usado por MONZO. Después de asignarlo y
repetir la autorización con el mismo token disponible, el usuario confirmó que todo
funciona. Los PR #1, #2 y #3 están integrados; ambos proyectos de Vercel terminaron
correctamente. No se copiaron tokens a este repositorio ni se alteró Neon.

## Fase 6 · Laboratorio Gemini gratuito preparado

El usuario eligió Gemini gratuito para pruebas. Primera entrega en
`feat/phase-6-gemini-lab`: agente por empresa con nombre, instrucciones,
conocimientos ficticios, pausa, revisión de configuración, cuota diaria y pregunta
manual de prueba. Respuestas de texto revisables, sin herramientas ni envío a
WhatsApp. No se carga historial, datos de contactos ni notas reales: las condiciones
actuales del nivel gratuito de Google excluyen datos personales y confidenciales.
La UI explica el tratamiento y exige confirmar datos ficticios; no promete detectar
ni anonimizar automáticamente datos personales.

Modelo fijo gemini-3.5-flash-lite, clave únicamente en GEMINI_API_KEY del servidor,
sin fallback ni reintento automático. Endpoint fijo, timeout y respuesta acotados;
los errores del proveedor no exponen su cuerpo. Cuotas atómicas compartidas y por
empresa sobre RateLimit, roles revisados bajo bloqueo y respuesta invalidada ante
pausa, cambio o revocación. No se almacena la respuesta de prueba como Message.

Séptima migración aditiva 202610300003_gemini_lab, aplicada solo en monzo_dev y
monzo_test locales. SQL protegido de Neon reproducible en docs/sql/phase-6-upgrade.sql;
el resultado requerido es **neondb | 1 | 10 | 7**. Se comprobó rollback atómico,
repetición segura, checksums, conservación de usuario/mensaje, referencias de tenant,
unicidad y rechazo de destino/historial/esquema incompatibles en una base temporal
exclusivamente local. Prisma validate y comparación de esquema sin diferencias.

Validación: **140/140** pruebas generales y **18/18** QStash en escritorio/móvil,
compilación webpack, TypeScript, lint, formato y diff correctos. La suite incluye
12 casos de IA (seis por proyecto) con transportes explícitos de Gemini y sesión/DB
reales, límites concurrentes, pausa durante HTTP, errores privados y recuperación de
la pregunta. Se corrigió un aislamiento de prueba previo que dejaba cambiada la
clave de cifrado de fixtures; no se cambió el cifrado de producción. Capturas de
escritorio/móvil revisadas sin desborde, con resultado enfocado y formularios conservados.

Pendientes externos: aplicar/confirmar la séptima migración en Neon y configurar una
clave de proyecto gratuito sin facturación en Vercel. No se consultó Gemini real,
no se accedió a secretos de producción ni se integra esta entrega a main antes de
confirmar la migración. Después del despliegue, guardar un agente ficticio habilitado
y probar una pregunta para confirmar clave, acceso al modelo y cuota del proveedor.
La asistencia con conversaciones reales y los agentes automáticos quedan fuera de
esta primera entrega. Alcance y pasos detallados en docs/phase-6.md.

## Neon Fase 6 confirmado · Preparación para publicación

El usuario compartió el resultado **neondb | 1 | 10 | 7**, confirmando tabla AiAgent,
sus diez columnas y siete migraciones aplicadas. La dependencia de esquema para
publicar Fase 6 queda satisfecha. No se conectó a Neon desde este entorno.

Se prepara la integración del PR #4 y se mantiene la validación previa de 140 pruebas
generales, 18 QStash y cuatro verificaciones finales de interfaz/contrato. La presencia
de GEMINI_API_KEY en Vercel y el acceso real al modelo todavía no están confirmados.
El laboratorio permite guardar la configuración sin clave y comunica por qué no se
puede consultar Gemini hasta que el servidor esté configurado. El despliegue no activa
agentes automáticamente ni envía mensajes de WhatsApp.

## Gemini: despliegue inicial completado y clave cargada por el usuario

El PR #4 se integró en main como 86e1fd2; los despliegues de monzo y monzo-v
terminaron correctamente según los estados de Vercel en GitHub. Después, el usuario
confirmó que guardó GEMINI_API_KEY en Vercel Production de monzo-v. No se leyó ni
se comprobó el valor del secreto desde este entorno.

Esta actualización documental activa un nuevo despliegue desde main para que Vercel
aplique las variables actuales. El acceso efectivo al modelo y la cuota gratuita
se confirmarán con una pregunta ficticia desde el laboratorio autenticado. No se
considera la presencia declarada de la clave como prueba de respuesta real de Gemini.

## Fase 7 · Árboles guiados y control humano preparados

El usuario autorizó continuar con automatizaciones de consultas/respuestas, editor
visual y simulador. Rama feat/phase-7-guided-flows: un flujo por número con preguntas
(botones/listas), respuestas finales y derivación al equipo; borrador separado de
publicación, revisión optimista, pausa y reactivación. No se usa Gemini ni se modifica
su facturación. No se activó ningún flujo real ni se enviaron mensajes desde este entorno.

El motor procesa una respuesta por entrante, con sourceId único y deduplicación de
webhooks. Guarda instantánea, versión y generación, y despacha IDs por la cola actual
después del commit. El worker vuelve a comprobar permisos, cuenta, ventana, versión
y control humano. Las respuestas automáticas se identifican en el historial. MENÚ
reinicia recorridos automáticos, sin levantar una derivación humana. Tres opciones
no reconocidas derivan al equipo; los límites de seis respuestas por hilo/minuto y
30 salientes por empresa/minuto pausan para revisión, sin responder en bucle.

Tomar atención, responder con texto/archivo/plantilla, asignar/quitar operador y
cerrar/reabrir pausan la automatización y cancelan solo sus mensajes QUEUED. Reanudar
requiere conversación abierta y sin asignación; no envía nada hasta el próximo
entrante. Las notas y lecturas no la pausan. Una pausa no puede retirar un mensaje
que ya fue reclamado; la UI lo explica y nunca reintenta resultados inciertos.
Si el publicador pierde permisos, se informa la necesidad de una nueva publicación.

Octava migración aditiva 202610300004_guided_flows: AutomationFlow y siete columnas
nuevas entre Conversation y Message, con referencias compuestas e índices. El valor
inicial de pausa es true: las conversaciones existentes y las creadas por código
anterior durante el despliegue quedan bajo control humano. El nuevo manejador habilita
explícitamente solo conversaciones recién recibidas. Generador y prueba de SQL en
scripts/prepare-phase-7-sql.mjs y scripts/test-phase-7-sql.mjs; resultado requerido de
Neon **neondb | 1 | 3 | 4 | 8**. Aplicada exclusivamente en monzo_dev/monzo_test locales;
no se accedió a Neon ni a secretos de producción.

Validación: **166/166** pruebas generales y **18/18** QStash aprobadas. Repetición final
**26/26** de automatizaciones después de ajustar la pausa inicial y los textos de
recuperación. Incluyen aislamiento/roles, referencias, revisión, versiones viejas,
ventana y mensajes demorados, límites, deduplicación, programación de IDs y claim
concurrente, pausa durante envío y conservación del borrador del chat. Compilación
webpack, tipos, lint y formato aprobados. SQL local temporal comprobó rollback,
conservación, checksums, repetición sin volver a pausar conversaciones y rechazo de
historial/esquema/destino incompatibles. Comparación de esquema local sin diferencias.

Capturas de escritorio/móvil revisadas del árbol, error de guardado recuperable,
simulador con Escape y restauración del foco, toma de atención/reanudación sin perder
el borrador ni sacar el compositor del viewport. Los contratos de Meta/QStash usan
transportes explícitos; la entrega real de botones/listas todavía debe probarse
tras publicar. No se presenta simulación como envío real.

Pendiente externo: ejecutar docs/sql/phase-7-upgrade.sql en Neon y confirmar la fila
final antes de integrar el nuevo cliente en main. No requiere variables, claves o
servicios nuevos. Después de publicar, crear/revisar el árbol, guardar, simular y
activar solo en el número de prueba; reanudar explícitamente un hilo existente antes
de probar desde el teléfono. Alcance, límites y pasos en docs/phase-7.md.

## Neon Fase 7 confirmado · Integración para publicación

El usuario compartió **neondb | 1 | 3 | 4 | 8**: AutomationFlow, tres columnas de
conversación, cuatro de mensaje y ocho migraciones aplicadas. Se confirma la
dependencia de esquema antes de integrar el PR #5 en main. No se accedió a Neon.

Se mantienen las verificaciones registradas de 166 pruebas generales, 18 QStash y
repetición final de 26 casos de automatizaciones. Los dos previews de Vercel del
código de la entrega finalizaron correctamente. Se prepara la publicación; falta
confirmar los despliegues de producción y un recorrido real de botones/listas.
No se activa ningún flujo del usuario automáticamente. Un hilo existente debe
reanudarse expresamente después de publicar su flujo para probarlo con el teléfono.

## Fase 7 publicada y fase 8 elegida

PR #5 integrado en main mediante ab817f4. Vercel confirmó ambos despliegues de producción. El usuario indicó continuar y eligió guardar respuestas, variables y condiciones como siguiente fase. No se atribuye a esta comprobación un envío externo observado por el entorno.

## Fase 8 · Entrega validada

Captura de respuestas, variables por conversación, comparaciones y destinos Sí/No, mensajes personalizados, simulador compartido y consulta de respuestas desde el chat. Sin nuevas migraciones, secretos o servicios; no utiliza Gemini. Estado y límites en docs/phase-8.md.

Validación: **172/172** generales, repetición final **32/32** automatizaciones y **18/18** QStash. Compilación webpack final, tipos, lint y formato aprobados. Capturas revisadas en escritorio/móvil de captura, simulador y panel de respuestas, con foco, borrador y compositor preservados. Meta y QStash usan transportes de prueba explícitos. Los dos previews finalizaron correctamente; se prepara la integración del PR #6. No se modifica ni activa automáticamente el árbol del usuario.
