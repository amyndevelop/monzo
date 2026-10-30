# Controles de acceso y seguridad · Fase 3

## Identidad y sesiones

Better Auth 1.7.14 proporciona hashing de contraseñas y gestión de cookies/sesiones. Contraseñas nuevas de 12 a 128 caracteres, sin truncarlas ni guardarlas en logs. Registro sin inicio de sesión automático y verificación de correo obligatoria. Los endpoints de registro, recuperación y reenvío usan la protección de enumeración de la biblioteca. Los mensajes de la interfaz no confirman la existencia de una cuenta.

Sesiones persistidas en PostgreSQL y verificadas por solicitud, con cookie cache desactivada. Cookies HttpOnly y SameSite=Lax; Secure se habilita cuando el origen configurado usa HTTPS. HTTP solo se permite en localhost/127.0.0.1; en Vercel el origen debe ser HTTPS público. La recuperación invalida las sesiones anteriores y cambia la contraseña en una transacción del adaptador. Los enlaces de recuperación son temporales y no reutilizables.

La vinculación automática de cuentas está deshabilitada. No hay login universal, usuario semilla, contraseña fija, login social incompleto ni bypass de verificación por entorno.

## Matriz de permisos

| Operación en una empresa                         | OWNER | ADMIN | MEMBER |
| ------------------------------------------------ | ----- | ----- | ------ |
| Ver inicio, preferencias y equipo                | Sí    | Sí    | Sí     |
| Cambiar nombre, idioma y zona horaria            | Sí    | Sí    | No     |
| Invitar miembros/admins                          | Sí    | No    | No     |
| Cambiar roles o revocar membresías               | Sí    | No    | No     |
| Quitar/demover al último propietario             | No    | No    | No     |
| Autorizar/desconectar número Meta                | Sí    | No    | No     |
| Reintentar recepciones fallidas                  | Sí    | No    | No     |
| Leer hilos/contactos, responder, anotar y cerrar | Sí    | Sí    | Sí     |
| Asignar conversación a otro miembro              | Sí    | Sí    | No     |
| Asignarse o desasignarse a sí mismo              | Sí    | Sí    | Sí     |

Una cuenta verificada puede crear hasta 20 empresas propias. Siempre se asigna OWNER en el servidor; no se acepta un rol enviado en ese formulario. El creador de una cuenta no recibe permisos en empresas ajenas. Los listados de membresías y equipos están acotados a 100 resultados: paginación para equipos mayores queda pendiente.

## Aislamiento

Los IDs de ruta, cookies, campos ocultos y selectores no son prueba de autorización. Se verifica el usuario por sesión, la membresía actual por `(tenantId, userId)` y el rol para cada operación. Un ID de membresía enviado bajo una empresa diferente no puede modificarse aunque el actor administre ambas.

Las actualizaciones bloquean la empresa y vuelven a comprobar la membresía dentro de la transacción. El bloqueo también preserva al último propietario frente a solicitudes concurrentes. Las lecturas se autorizan por solicitud, sin caches globales de usuarios o empresas. Prisma se reutiliza como conexión, no como cache de permisos. RLS no está implementado: la defensa actual está en la capa de acceso, validada con solicitudes cruzadas y pruebas negativas.

## Invitaciones

Tokens aleatorios de 32 bytes; solo SHA-256 en la base. Caducidad de 48 horas, un uso y destinatario con correo verificado. Invitar no otorga acceso hasta aceptar. Renovar una invitación rota su token. Aceptar una invitación no modifica un rol ya existente ni permite unirse con otro correo. No se envía la lista de invitaciones ni sus hashes al cliente.

Si SMTP falla, no se muestra éxito. Una invitación pendiente puede haber quedado registrada; repetir el envío genera un enlace nuevo. Los correos usan texto plano y asuntos fijos; el nombre de empresa no se interpreta como HTML.

## Solicitudes y abuso

Las mutaciones de negocio usan POST/PATCH/DELETE, origen exacto, tipo JSON, límite de 8 KiB (24 KiB para respuestas, 16 KiB para notas) y esquemas Zod estrictos. Better Auth aplica su protección de origen a autenticación. Los endpoints de negocio devuelven errores genéricos sin URLs de conexión, stacktraces o cuerpos de solicitud. Las respuestas de datos privados llevan `Cache-Control: no-store`.

Los límites de autenticación se guardan en PostgreSQL para compartirlos entre instancias: 8 intentos de login, 5 registros y 3 solicitudes de recuperación/reenvío por minuto e IP, además del límite general. En Vercel se utiliza `x-vercel-forwarded-for`; en desarrollo `x-forwarded-for`. Cualquier otro hosting debe configurar un proxy de confianza que sobrescriba ese encabezado antes de exponer el servicio. Estos límites no sustituyen WAF, monitoreo o protección distribuida de abuso.

## Secretos, correo y publicación

`.env` y `.env.test` están ignorados; el script de preparación no imprime secretos ni reemplaza valores personalizados. Mailpit y ambas bases escuchan solamente en loopback. Los correos de prueba se capturan localmente y no se entregan a Internet. SMTP remoto requiere autenticación y TLS con validación de certificados. El dominio/remitente real debe verificarse con el proveedor.

Los enlaces de verificación, recuperación e invitación contienen tokens sensibles: no copiarlos a logs, analíticas o chat. No se integraron analíticas de terceros en esas páginas. Las páginas de cuenta no se indexan. Los reportes de pruebas con cuentas efímeras no se suben a GitHub.

Antes de producción: configurar secretos, PostgreSQL y SMTP separados de desarrollo; revisar migraciones; comprobar cookie Secure bajo HTTPS y entrega externa real; realizar pruebas de acceso tras despliegue. No se afirma auditoría independiente, cumplimiento normativo ni cobertura de amenazas fuera de estas comprobaciones.

## WhatsApp

El webhook público no usa sesión ni origen de navegador: valida HMAC-SHA256 sobre bytes originales, con comparación constante y App Secret real. Su Verify Token solo sirve para el desafío GET y no firma mensajes. Se limita el cuerpo a 1 MiB y se valida antes de persistir. Cada evento se asocia únicamente a un número habilitado y a la WABA correspondiente; el cliente no elige tenantId.

Los tokens de Meta usan AES-256-GCM con IV aleatorio y AAD de empresa/número, nunca se devuelven en DTOs, logs o Redis. Web y worker comparten la clave secreta; no se admite sustituirla por un placeholder de proxy porque el proceso la usa para cifrado. La autorización exige comprobar que el número pertenece a la WABA y suscribir la app. Las llamadas usan host y paths fijos, TLS verificado, proxy del entorno, timeout y prohibición de redirecciones.

Las respuestas requieren membresía actual y ventana de 24 horas, revalidadas al reclamar el envío. Idempotencia UUID y bloqueo transaccional evitan repetir un registro; un resultado externo incierto queda UNKNOWN sin reintento automático. No se promete entrega exactly-once. Un rechazo antiguo de token no invalida una credencial renovada durante la petición. Desconexión y revocación impiden pendientes, sin poder retirar una solicitud ya enviada a Meta.

Redis remoto exige TLS. El contenedor corre como usuario sin privilegios, excluye .env y contiene un chequeo de heartbeat. Los payloads procesados se vacían; el worker BullMQ depura registros DONE a los siete días, mientras QStash conserva esos metadatos hasta limpieza administrativa; fallidos conservan payload para revisión. Mensajes y notas no tienen borrado automático: definir retención antes de incorporar datos de clientes externos. La preparación y los límites de producción están en `docs/phase-3.md`.

## Entregas QStash

En modo qstash el endpoint de trabajos no usa sesión: requiere una firma QStash válida, distinta de la firma de Meta. La biblioteca oficial verifica JWT, emisor, vigencia, cuerpo original y URL configurada. Admite claves actual/siguiente; sin claves válidas no procesa trabajos. Cuerpo máximo 2 KiB y esquema estricto tipo/ID, sin tenantId elegido por el emisor. El endpoint queda deshabilitado en modo BullMQ.

La publicación solo admite destinos oficiales de Upstash, TLS verificado y sin redirecciones, preservando el proxy. Las colas contienen IDs, nunca contenido ni tokens de Meta. La recuperación exige OWNER y bloquea/revalida su membresía; solo selecciona pendientes de esa empresa. El callback conserva las mismas comprobaciones de ventana, cuenta y actor que el worker. UNKNOWN no se reenvía. Los transportes reales rechazan la base monzo_test: fixtures nunca publican a QStash ni Meta.

## Adjuntos · Fase 4

Las mutaciones de adjuntos usan multipart con origen exacto y autorización antes de leer un cuerpo acotado a 3 MiB + 32 KiB. Se validan bytes reales con file-type; el nombre/MIME del cliente no autoriza el formato. Un archivo validado no implica ausencia de malware; documentos se sirven como descarga. La cuenta y membresía se revalidan después de subir a Meta antes de guardar/encolar. La ventana, estado de cuenta y actor se comprueban de nuevo al enviar.

La descarga solo acepta el ID de un mensaje de la empresa autorizada, nunca una URL o ID de medio suministrado por el navegador. Se obtiene metadato de Graph con el Phone Number ID de la cuenta; se exige HTTPS, host/ruta fija de Meta, sin credenciales en URL ni redirecciones. Se acotan bytes del stream, verifican tamaño, tipo y hashes disponibles, y se revalida acceso antes de entregar bytes. Respuestas private/no-store, nosniff, CSP y CORP; documentos descargables, nombres saneados y rangos simples para reproductores. No se revelan tokens ni URLs temporales. Límites compartidos por empresa: 10 subidas y 60 descargas/minuto. Detalles y límites de retención en `docs/phase-4.md`.
