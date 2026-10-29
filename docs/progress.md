# Progreso de MONZO

Fecha: 29 de octubre de 2026.

## Fase 1 · Publicada

Landing Cloud, demo visual, recursos oficiales y fundación técnica completados. El código se subió a `amyndevelop/monzo`, commit `ea36ede`, y el usuario desplegó esa versión en Vercel: `https://monzo-v.vercel.app`. Las capturas del usuario confirmaron la landing y la demo funcionando con el logo y la mascota.

El logo se exportó del PDF vectorial a SVG sin redibujar o recolorear. Los dos PDFs originales se conservan en `assets/brand/originals/`; las 20 expresiones de la mascota conservan sus máscaras de transparencia. Los originales de la mascota tienen resolución limitada; no se generaron detalles artificiales.

## Fase 2 · Implementada y validada localmente

Entrega preparada en `feat/phase-2-auth-tenants` para publicar en `main`, después de configurar los servicios y comprobar las tablas. El resultado del despliegue y los correos reales se verifica por separado. No se inició una fase posterior.

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

### Preparación de producción y verificación pendiente

- Neon `monzo-db`, rama `main`, base `neondb`, conectada al proyecto Vercel `monzo-v`.
- El usuario ejecutó el SQL y confirmó una consulta de solo lectura con **10 tablas y 2 migraciones aplicadas** en neondb. No se usaron ni solicitaron credenciales de conexión en el chat.
- Resend muestra verificado `notificaciones.puntounodev.com.ar`. El usuario confirmó haber guardado la configuración SMTP en Vercel y el secreto de autenticación, con el origen `https://monzo-v.vercel.app`.
- La entrega se sube a GitHub para activar el despliegue automático autorizado. Un push no demuestra que Vercel haya terminado ni que el correo externo funcione.
- Pendientes después del despliegue: estado Ready, registro real, entrega de correo de verificación, acceso HTTPS, creación de empresa y cierre de sesión. La comprobación de cookies Secure en producción sigue pendiente.

Las credenciales de Vercel no se leyeron desde este entorno; su configuración fue confirmada por el usuario. No se afirma entrega externa de correo ni funcionamiento completo de producción hasta comprobar esos pasos. RLS, MFA, canales, IA, worker, automatizaciones, CRM, pagos y analíticas operativas siguen fuera de alcance. Ver `docs/phase-2.md` y `docs/security.md`.
