# Controles de acceso y seguridad · Fase 2

## Identidad y sesiones

Better Auth 1.7.14 proporciona hashing de contraseñas y gestión de cookies/sesiones. Contraseñas nuevas de 12 a 128 caracteres, sin truncarlas ni guardarlas en logs. Registro sin inicio de sesión automático y verificación de correo obligatoria. Los endpoints de registro, recuperación y reenvío usan la protección de enumeración de la biblioteca. Los mensajes de la interfaz no confirman la existencia de una cuenta.

Sesiones persistidas en PostgreSQL y verificadas por solicitud, con cookie cache desactivada. Cookies HttpOnly y SameSite=Lax; Secure se habilita cuando el origen configurado usa HTTPS. HTTP solo se permite en localhost/127.0.0.1; en Vercel el origen debe ser HTTPS público. La recuperación invalida las sesiones anteriores y cambia la contraseña en una transacción del adaptador. Los enlaces de recuperación son temporales y no reutilizables.

La vinculación automática de cuentas está deshabilitada. No hay login universal, usuario semilla, contraseña fija, login social incompleto ni bypass de verificación por entorno.

## Matriz de permisos

| Operación en una empresa              | OWNER | ADMIN | MEMBER |
| ------------------------------------- | ----- | ----- | ------ |
| Ver inicio, preferencias y equipo     | Sí    | Sí    | Sí     |
| Cambiar nombre, idioma y zona horaria | Sí    | Sí    | No     |
| Invitar miembros/admins               | Sí    | No    | No     |
| Cambiar roles o revocar membresías    | Sí    | No    | No     |
| Quitar/demover al último propietario  | No    | No    | No     |

Una cuenta verificada puede crear hasta 20 empresas propias. Siempre se asigna OWNER en el servidor; no se acepta un rol enviado en ese formulario. El creador de una cuenta no recibe permisos en empresas ajenas. Los listados de membresías y equipos están acotados a 100 resultados: paginación para equipos mayores queda pendiente.

## Aislamiento

Los IDs de ruta, cookies, campos ocultos y selectores no son prueba de autorización. Se verifica el usuario por sesión, la membresía actual por `(tenantId, userId)` y el rol para cada operación. Un ID de membresía enviado bajo una empresa diferente no puede modificarse aunque el actor administre ambas.

Las actualizaciones bloquean la empresa y vuelven a comprobar la membresía dentro de la transacción. El bloqueo también preserva al último propietario frente a solicitudes concurrentes. Las lecturas se autorizan por solicitud, sin caches globales de usuarios o empresas. Prisma se reutiliza como conexión, no como cache de permisos. RLS no está implementado: la defensa actual está en la capa de acceso, validada con solicitudes cruzadas y pruebas negativas.

## Invitaciones

Tokens aleatorios de 32 bytes; solo SHA-256 en la base. Caducidad de 48 horas, un uso y destinatario con correo verificado. Invitar no otorga acceso hasta aceptar. Renovar una invitación rota su token. Aceptar una invitación no modifica un rol ya existente ni permite unirse con otro correo. No se envía la lista de invitaciones ni sus hashes al cliente.

Si SMTP falla, no se muestra éxito. Una invitación pendiente puede haber quedado registrada; repetir el envío genera un enlace nuevo. Los correos usan texto plano y asuntos fijos; el nombre de empresa no se interpreta como HTML.

## Solicitudes y abuso

Las mutaciones de negocio usan POST/PATCH/DELETE, origen exacto, tipo JSON, límite de 8 KiB y esquemas Zod estrictos. Better Auth aplica su protección de origen a autenticación. Los endpoints de negocio devuelven errores genéricos sin URLs de conexión, stacktraces o cuerpos de solicitud. Las respuestas de datos privados llevan `Cache-Control: no-store`.

Los límites de autenticación se guardan en PostgreSQL para compartirlos entre instancias: 8 intentos de login, 5 registros y 3 solicitudes de recuperación/reenvío por minuto e IP, además del límite general. En Vercel se utiliza `x-vercel-forwarded-for`; en desarrollo `x-forwarded-for`. Cualquier otro hosting debe configurar un proxy de confianza que sobrescriba ese encabezado antes de exponer el servicio. Estos límites no sustituyen WAF, monitoreo o protección distribuida de abuso.

## Secretos, correo y publicación

`.env` y `.env.test` están ignorados; el script de preparación no imprime secretos ni reemplaza valores personalizados. Mailpit y ambas bases escuchan solamente en loopback. Los correos de prueba se capturan localmente y no se entregan a Internet. SMTP remoto requiere autenticación y TLS con validación de certificados. El dominio/remitente real debe verificarse con el proveedor.

Los enlaces de verificación, recuperación e invitación contienen tokens sensibles: no copiarlos a logs, analíticas o chat. No se integraron analíticas de terceros en esas páginas. Las páginas de cuenta no se indexan. Los reportes de pruebas con cuentas efímeras no se suben a GitHub.

Antes de producción: configurar secretos, PostgreSQL y SMTP separados de desarrollo; revisar migraciones; comprobar cookie Secure bajo HTTPS y entrega externa real; realizar pruebas de acceso tras despliegue. No se afirma auditoría independiente, cumplimiento normativo ni cobertura de amenazas fuera de estas comprobaciones.
