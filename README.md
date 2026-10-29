# MONZO · Fase 2

Plataforma SaaS en desarrollo. Landing comercial, demo pública y acceso real por cuenta verificada a espacios independientes de empresa. La Fase 1 está publicada y esta entrega prepara la Fase 2. El push autorizado a main activa el despliegue automático de Vercel; el estado y los flujos reales de producción se verifican por separado.

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

Los canales, IA, conversaciones operativas, CRM, pagos y automatizaciones siguen marcados como próximos. No se muestran métricas inventadas ni se afirman integraciones que no existen.

## Verificación

```sh
npm run db:validate
npm run typecheck
npm run lint
npm run format:check
npm run build
npm test
```

Las pruebas arrancan su propio servidor de producción local en el puerto 3100 con `.env.test`; migran solamente la instancia `127.0.0.1:55433/monzo_test`. El runner rechaza otra ubicación. No resetean ni migran `monzo_dev` o producción. Usan SMTP real contra Mailpit, cuentas y empresas generadas expresamente para pruebas, y Chromium preinstalado o `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. En otro equipo puede instalarse con `npx playwright install chromium`.

Los datos de prueba permanecen en la base de pruebas, nunca en la aplicación de producción. Las capturas y reportes se escriben en `test-results/` y `playwright-report/`, ignorados por Git. No ejecutar desarrollo y build simultáneamente: comparten `.next`.

## Base de datos y acceso

Prisma prepara el esquema y las migraciones aditivas versionadas. Better Auth gestiona cuentas, hashing de contraseñas, verificación de correo, sesiones, recuperación, protección de origen y límites de intentos persistidos en PostgreSQL. Las consultas y mutaciones de empresa pasan por la capa de autorización del servidor. El selector y la cookie de empresa son entradas no confiables: se verifica siempre la membresía actual.

`npm run build` regenera el cliente Prisma antes de compilar para evitar clientes desactualizados en la caché de Vercel; no migra la base.

`db:migrate` aplica migraciones pendientes; no contiene resets ni borrados de tablas. Para una base existente sin historial Prisma, verificar su esquema y preparar un baseline revisado por separado. No usar `db push` o marcar migraciones como aplicadas a ciegas.

## Publicación de Fase 2

Antes de habilitar cuentas reales en Vercel hacen falta una base PostgreSQL gestionada, un proveedor SMTP con remitente verificado, `BETTER_AUTH_URL` con el dominio HTTPS real y un `BETTER_AUTH_SECRET` aleatorio. Guardarlos en Vercel, nunca en Git ni en el chat. Usar bases y secretos separados para desarrollo, Preview y Production. Vercel no ejecuta Docker Compose.

Las páginas de acceso informan que el servicio aún no está habilitado si la configuración está incompleta; las APIs privadas deniegan el acceso. No hay modo de autenticación simulado ni bypass de verificación en producción. Las migraciones de producción, el merge a `main` y el despliegue necesitan una instrucción explícita. Ver [Fase 2](docs/phase-2.md) y [seguridad](docs/security.md).

## Estructura

- `src/app/`: sitio, demo, acceso, rutas privadas y APIs.
- `src/modules/auth/`: Better Auth, configuración y correo, solo servidor donde corresponde.
- `src/modules/access/`: identidad y autorización de cada solicitud.
- `src/modules/tenants/`: datos de empresa, roles, preferencias e invitaciones.
- `src/components/`: branding, UI Cloud, formularios y navegación.
- `prisma/`: modelos y migraciones.
- `scripts/`: preparación de desarrollo y runner aislado de pruebas.
- `public/brand/`, `assets/brand/originals/`: recursos oficiales y originales preservados.

El logo proviene del PDF vectorial original, sin redibujar ni recolorear; las 20 reacciones de la mascota conservan transparencias. Ver [branding](docs/branding.md).
