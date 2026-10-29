# MONZO · Fase 1

Plataforma SaaS de atención, IA y automatización, en desarrollo. Esta entrega contiene una landing comercial y una **demo visual pública** del dashboard. No hay autenticación, empresas conectadas, mensajes reales ni integraciones activas.

## Desarrollo

Requisitos: Node.js 24 LTS (probado con 24.19.0), npm 11.9.0. Usar el checkout existente; no crear un worktree para la configuración habitual.

```sh
npm ci
# Solo si no existe .env: copiar .env.example a .env. No sobrescribir configuración propia.
cp -n .env.example .env
npm run db:generate
npm run db:validate
npm run dev
```

La landing vive en `/`; la demo pública, en `/dashboard`. PostgreSQL no es necesario para estas páginas. `DATABASE_URL` es un ejemplo de desarrollo, no una credencial de producción. No se han creado usuarios, tablas ni datos.

## Verificación

```sh
npm run typecheck
npm run lint
npm run build
npm test
# Comprobación completa, incluyendo esquema Prisma:
npm run check
```

Playwright inicia el build de producción en el puerto 3100, prueba escritorio (1440 px) y móvil (390 px) y genera capturas en `test-results/`. Necesita un build previo. Usa `/usr/bin/chromium` cuando está disponible; en otro equipo ejecutar `npx playwright install chromium` o indicar `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Las pruebas no usan servicios externos ni una base de datos. No ejecutar el servidor de desarrollo simultáneamente con un build en el mismo checkout porque comparten `.next`.

`npm run start` sirve el último build. Para desarrollo usar `npm run dev` (puerto 3000). Los procesos deben iniciarse nuevamente en cada instancia.

## PostgreSQL y Prisma

`prisma/schema.prisma` prepara `User`, `Tenant`, `Membership` y `TenantSettings`. `db:generate` genera el cliente y `db:validate` valida el esquema, **sin conectarse ni migrar una base de datos**. Los motores de Prisma requieren acceso HTTPS a `binaries.prisma.sh` con verificación TLS y de checksums. La generación del cliente y la validación del esquema ya pasaron en el entorno restaurado después de la publicación; ver `docs/progress.md`.

La conexión futura se obtiene exclusivamente en servidor mediante `getDb()`. No hay endpoints operativos ni repositorios de datos accesibles. La política `requireTenantAccess()` deniega todas las operaciones hasta implementar autenticación y autorización en la Fase 2. No se garantiza aislamiento multiempresa solamente con el esquema: requerirá controles y pruebas específicos.

Separar bases y secretos de desarrollo, pruebas y producción. No ejecutar `db push`, resets ni migraciones durante esta fase. Redis, BullMQ, OpenAI y Meta se incorporarán cuando su funcionalidad sea autorizada, sin claves ficticias.

## Estructura

- `src/app/`: landing, layout, demo y páginas de próximas funcionalidades.
- `src/components/`: branding, componentes de interfaz shadcn/ui y shells.
- `src/modules/`: navegación del producto y límite de acceso denegado por defecto.
- `src/lib/`: utilidades y punto de acceso al cliente Prisma, solo servidor.
- `prisma/`: esquema PostgreSQL.
- `public/brand/mascot/`: 20 reacciones originales con transparencia en WebP sin pérdida.
- `assets/brand/originals/`: PDF original preservado.
- `tests/`: pruebas funcionales y de la política de acceso.
- `docs/`: arquitectura, branding, roadmap y evidencia de progreso.

El logo oficial se exportó directamente del PDF vectorial recibido y está integrado en `public/brand/logo/monzo-light.svg`. El original se conserva en `assets/brand/originals/monzo-logo.pdf`. Sus formas, proporciones y colores se mantienen; se presenta sobre una superficie petróleo para dar contraste a las letras claras.

No se hizo despliegue de producción. No se implementó la Fase 2.
