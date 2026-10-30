# MONZO · Fase 4 en publicación

Plataforma SaaS en desarrollo. Landing comercial, demo pública y acceso por cuenta verificada a espacios independientes de empresa. Las Fases 1, 2 y 3 están publicadas: el usuario confirmó recepción y respuesta de texto con Meta real mediante Vercel/QStash. La Fase 4 agrega adjuntos y está integrada en main para publicación. El usuario confirmó la quinta migración de Neon; faltan Ready y la prueba real de archivos. Ver [Fase 4](docs/phase-4.md). El push autorizado a main activa el despliegue automático de Vercel; los flujos de producción se verifican por separado.

## Desarrollo local

Requisitos: Node.js 24.19.0 (`.nvmrc`), npm y Docker Compose. Usar el checkout existente, sin crear worktrees ni reinicializar Git.

```sh
npm ci
npm run setup:local
npm run services:up
npm run db:generate
npm run db:migrate
npm run dev
```

`setup:local` genera secretos locales en `.env` y `.env.test`, ambos ignorados, sin imprimir sus valores ni reemplazar valores personalizados. Si ya usabas otra base, revisá `DATABASE_URL` antes de migrar; este flujo está probado con las bases locales de Compose. No usar credenciales de producción para desarrollo o pruebas.

Compose inicia PostgreSQL 17 en `127.0.0.1:5432` (`monzo_dev`), otra instancia en `127.0.0.1:55433` (`monzo_test`) y Mailpit en los puertos locales 1025 (SMTP) y 8025 (buzón de desarrollo). Las imágenes están fijadas por digest. Los datos de desarrollo y pruebas usan volúmenes diferentes. `npm run services:stop` detiene los servicios sin borrar sus volúmenes. No ejecutar `down -v` para reiniciar un proceso.

Abrir el sitio local en el origen exacto de `BETTER_AUTH_URL`, inicialmente `http://localhost:3000`. Crear una cuenta en `/registro`, consultar su mensaje en el buzón Mailpit local y abrir el enlace de verificación. Luego ingresar, crear una empresa y administrar sus preferencias y equipo. Mailpit **captura correos solo en desarrollo**: no representa entrega a destinatarios externos.

## Rutas

| Ruta                                   | Acceso / función                                                      |
| -------------------------------------- | --------------------------------------------------------------------- |
| `/`                                    | Landing pública                                                       |
| `/demo`                                | Demostración visual pública, sin sesión ni datos reales               |
| `/registro`, `/ingresar`, `/verificar` | Cuenta, acceso y reenvío de verificación                              |
| `/recuperar`, `/restablecer`           | Recuperación por correo, con token temporal                           |
| `/empresas`                            | Listar, crear y seleccionar empresas propias; sesión verificada       |
| `/dashboard`                           | Inicio de empresa; sesión y membresía verificadas                     |
| `/dashboard/equipo`                    | Miembros; propietarios pueden invitar, cambiar roles y revocar acceso |
| `/dashboard/configuracion`             | Preferencias; propietarios y administradores pueden modificar         |
| `/invitacion`                          | Aceptación explícita con cuenta del correo invitado, verificada       |

La Fase 3 agrega `/dashboard/canales`, `/dashboard/conversaciones`, `/dashboard/contactos` y `/api/webhooks/whatsapp`. La Fase 4 extiende esa bandeja con adjuntos privados y requiere primero la migración 5; ver [operación y publicación de adjuntos](docs/phase-4.md). La integración requiere una app real de Meta y un procesador configurado (QStash por eventos o worker BullMQ); `setup:local` no simula una conexión. IA, plantillas, CRM, pagos y automatizaciones siguen pendientes. Ver [Fase 3](docs/phase-3.md).

Compose incluye Redis 7 con contraseña en `127.0.0.1:6379`, DB 0 para desarrollo y DB 1 para pruebas. Para procesar mensajes de desarrollo, abrir otra terminal en este directorio y ejecutar `npm run worker`. Web y worker comparten base y clave de cifrado. Con `WHATSAPP_PROCESSOR=qstash`, Vercel ejecuta los trabajos mediante callbacks firmados y no hace falta Redis ni proceso permanente. Esta es la ruta elegida para las pruebas con presupuesto gratuito; confirmar plan/cuotas Free en Upstash. El modo BullMQ permanece disponible para desarrollo o un servidor propio. `Dockerfile.worker` crea la imagen de producción sin archivos de secretos, con usuario sin privilegios y comprobación de salud.

## Verificación

```sh
npm run db:validate
npm run typecheck
npm run lint
npm run format:check
npm run build
npm test
npm run test:qstash
```

`test:qstash` prueba por separado callbacks HTTP firmados sin worker permanente; no envía credenciales ficticias a QStash o Meta. Las pruebas arrancan su propio servidor de producción local en el puerto 3100 con `.env.test`; migran solamente la instancia `127.0.0.1:55433/monzo_test`. El runner rechaza otra ubicación y también restringe Redis a DB 1 local. Inicia un worker real de recepción; las llamadas salientes a Meta se verifican con transportes inyectados y nunca envían credenciales ficticias a Internet. No resetean ni migran `monzo_dev` o producción. Usan SMTP real contra Mailpit, cuentas y empresas generadas expresamente para pruebas, y Chromium preinstalado o `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. En otro equipo puede instalarse con `npx playwright install chromium`.

Los datos de prueba permanecen en la base de pruebas, nunca en la aplicación de producción. Las capturas y reportes se escriben en `test-results/` y `playwright-report/`, ignorados por Git. No ejecutar desarrollo y build simultáneamente: comparten `.next`.

## Base de datos y acceso

Prisma prepara el esquema y las migraciones aditivas versionadas. Better Auth gestiona cuentas, hashing de contraseñas, verificación de correo, sesiones, recuperación, protección de origen y límites de intentos persistidos en PostgreSQL. Las consultas y mutaciones de empresa pasan por la capa de autorización del servidor. El selector y la cookie de empresa son entradas no confiables: se verifica siempre la membresía actual.

`npm run build` regenera el cliente Prisma antes de compilar para evitar clientes desactualizados en la caché de Vercel; no migra la base.

`db:migrate` aplica migraciones pendientes; no contiene resets ni borrados de tablas. Para una base existente sin historial Prisma, verificar su esquema y preparar un baseline revisado por separado. No usar `db push` o marcar migraciones como aplicadas a ciegas.

## Publicación

Antes de habilitar cuentas reales en Vercel hacen falta una base PostgreSQL gestionada, un proveedor SMTP con remitente verificado, `BETTER_AUTH_URL` con el dominio HTTPS real y un `BETTER_AUTH_SECRET` aleatorio. Guardarlos en Vercel, nunca en Git ni en el chat. Usar bases y secretos separados para desarrollo, Preview y Production. Vercel no ejecuta Docker Compose.

Las páginas de acceso informan que el servicio aún no está habilitado si la configuración está incompleta; las APIs privadas deniegan el acceso. No hay modo de autenticación simulado ni bypass de verificación en producción. Las migraciones de producción, el merge a `main` y el despliegue necesitan una instrucción explícita. La Fase 2 está publicada en `https://monzo-v.vercel.app`; el usuario confirmó correo, verificación, acceso y creación de empresa. Ver [Fase 2](docs/phase-2.md), [Fase 3](docs/phase-3.md) y [seguridad](docs/security.md).

## Estructura

- `src/app/`: sitio, demo, acceso, rutas privadas y APIs.
- `src/modules/auth/`: Better Auth, configuración y correo, solo servidor donde corresponde.
- `src/modules/access/`: identidad y autorización de cada solicitud.
- `src/modules/tenants/`: datos de empresa, roles, preferencias e invitaciones.
- `src/modules/whatsapp/`: autorización, cifrado, ingestión y contrato de Meta.
- `workers/`: proceso independiente Redis/BullMQ y comprobación de salud.
- `src/components/`: branding, UI Cloud, formularios y navegación.
- `prisma/`: modelos y migraciones.
- `scripts/`: preparación de desarrollo y runner aislado de pruebas.
- `public/brand/`, `assets/brand/originals/`: recursos oficiales y originales preservados.

El logo proviene del PDF vectorial original, sin redibujar ni recolorear; las 20 reacciones de la mascota conservan transparencias. Ver [branding](docs/branding.md).
