# Arquitectura · Fundación

## Decisiones

Monolito modular con Next.js App Router, TypeScript estricto y React Server Components por defecto. Los únicos componentes cliente gestionan navegación, menú responsive y el selector informativo de empresa. Las rutas actuales son estáticas; no leen datos privados ni crean sesiones. Fuente Inter alojada localmente con `@fontsource-variable/inter`, sin dependencia de Google Fonts en runtime o build.

Tailwind CSS 4 procesa estilos y tokens. `components.json`, `cn()` y `Button` siguen la arquitectura de shadcn/ui (Radix Slot, CVA, Tailwind Merge). Los componentes son código local extensible; no se instaló un kit administrativo. Lucide provee los iconos de interfaz, no reemplazos del branding.

Prisma 6.19.3 y `@prisma/client` usan la misma versión estable de la línea 6, evitando versiones preliminares de Prisma 8. Next.js 16.4.3 y React 19.3.1 fueron consultados en npm e instalados con lockfile. `npm ci` reproduce las versiones resueltas. Node está fijado en `.nvmrc`.

## Límites de módulos

| Área                         | Implementado en Fase 1                  | Evolución prevista                              |
| ---------------------------- | --------------------------------------- | ----------------------------------------------- |
| Sitio                        | Landing, anclas y navegación responsive | Contenido comercial verificado                  |
| Plataforma                   | Shell y estados próximos públicos       | Rutas operativas protegidas                     |
| Acceso                       | Denegación de cualquier operación       | Identidad verificada en servidor y autorización |
| Empresas                     | Esquema Tenant/Membership/Settings      | Contexto autorizado por solicitud               |
| IA, canales, CRM, analíticas | Presentación de capacidades futuras     | Módulos independientes dentro del monolito      |
| Procesos asíncronos          | Diseño documentado                      | Worker Node independiente con Redis/BullMQ      |

El worker no está creado ni ejecutándose. Las tareas largas de Meta/IA no deberán depender de la vida de un request de Vercel; se enviarán a colas, con idempotencia, retries limitados y límites por tenant. Redis, BullMQ, OpenAI y Meta no se instalaron porque no se usan en esta fase. El despliegue de frontend/endpoints compatibles en Vercel y worker en VPS pertenece a fases posteriores.

## Modelo de datos

`User` representa identidad global, con email único. `Tenant` representa empresa, con slug único. `Membership` vincula usuario y empresa con una única pareja `(tenantId, userId)` y rol OWNER/ADMIN/MEMBER; el rol por defecto es MEMBER. Tiene índice de búsqueda por usuario. `TenantSettings` es una relación opcional uno a uno; no se crea automáticamente. Fechas de creación y actualización soportan trazabilidad básica. Las relaciones usan `Restrict`, sin borrados en cascada.

No hay contraseñas, semillas ni tenant por defecto. No se ejecutaron migraciones. El esquema no sustituye autorización. En Fase 2, cada operación deberá verificar sesión y membresía en servidor, derivar `tenantId` del contexto autorizado y filtrar cada consulta. Nunca confiar solamente en el selector visual, cookies sin verificar, IDs del cliente o un rol recibido por request. Probar acceso cruzado, revocación de membresía y elevación de privilegios antes de habilitar datos reales. Evaluar RLS como defensa adicional.

## Seguridad y límites actuales

La demo es deliberadamente pública y no representa una sesión. No existe login falso, almacenamiento de credenciales ni endpoints que modifiquen datos. `src/modules/access/policy.ts` falla de forma cerrada y `src/lib/db.ts` está restringido al servidor, con inicialización diferida. No se hacen consultas Prisma en las páginas públicas.

Cabeceras `nosniff`, `DENY`, política de referer y permisos de cámara/micrófono/geolocalización restringidos. Metadatos de la demo excluyen indexación; esto no es un control de acceso. La autenticación completa, protección de acciones, controles de abuso, CSP ajustada al despliegue y pruebas de aislamiento siguen pendientes. No se afirma cumplimiento normativo ni seguridad multiempresa completa.

## Entornos

Desarrollo: `.env` local ignorado y ejemplo explícito de PostgreSQL local. Pruebas actuales: navegador contra build de producción, sin base ni APIs. Futuras pruebas de integración: base aislada `monzo_test`, nunca producción. Producción: secretos gestionados por el proveedor y migraciones revisadas; no configurada ni desplegada.
