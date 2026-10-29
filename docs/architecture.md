# Arquitectura · Fase 2

Monolito modular Next.js App Router, TypeScript estricto, Prisma 6.19.3 y PostgreSQL 17. React Server Components para obtener datos autorizados y componentes cliente para formularios y navegación. Inter se sirve localmente. Tailwind 4, shadcn/ui y Lucide conservan la identidad Cloud.

## Rutas y límites

El sitio y `/demo` son públicos. Las cuentas viven en rutas de acceso explícitas. `/empresas`, `/dashboard` y las APIs de empresa requieren sesión y correo verificado. El layout privado ayuda a la navegación, pero no es el límite de seguridad: cada página que obtiene datos y cada endpoint vuelven a autorizar la operación en el servidor.

`src/modules/auth` integra Better Auth 1.7.14 con el adaptador Prisma y transacciones habilitadas. La instancia se inicializa de forma diferida; `isAuthConfigured` permite mostrar un estado de preparación si faltan requisitos, sin crear sesiones falsas. La biblioteca gestiona contraseñas, cookies, tokens de correo y sesiones persistentes. SMTP usa Nodemailer con TLS obligatorio fuera de desarrollo local; Mailpit captura los mensajes de las pruebas.

`src/modules/access` valida sesiones contra la base sin cookie cache. La cookie de empresa solamente identifica una selección. No se acepta un `userId` enviado por el cliente ni un rol de un formulario para decidir permisos.

`src/modules/tenants` encapsula todas las consultas de empresa y usa Prisma solo servidor. GET requiere identidad y membresía. Mutaciones JSON requieren además el origen exacto, contenido acotado y validación de campos; no aceptan roles de creación de empresa del cliente. Al crearla se asigna OWNER en una transacción.

## Modelo

- User y Account: identidad y credencial de Better Auth; sin contraseña en User.
- Session: sesión persistente, vencimiento y token de Better Auth. No se devuelve la tabla en DTOs de la UI.
- Verification: tokens temporales de la biblioteca para recuperación.
- RateLimit: límites de autenticación compartidos en PostgreSQL.
- Tenant y TenantSettings: identidad y preferencias de cada empresa.
- Membership: vínculo único tenant/usuario con OWNER, ADMIN o MEMBER.
- TenantInvitation: destinatario, rol, expiración y hash del token; relación obligatoria con empresa.

Las relaciones del dominio conservan `Restrict`: no hay eliminación de empresas ni borrados en cascada de datos de clientes. Sesiones/cuentas usan cascada sobre su usuario, pero no se habilitó la eliminación pública de usuarios. La migración inicial reproduce el esquema de Fase 1; la segunda agrega autenticación e invitaciones sin drops o resets.

## Concurrencia y revocación

Cambios de preferencias y membresías bloquean la fila de la empresa dentro de una transacción y revalidan el rol después de obtener el bloqueo. La eliminación/democión de propietarios cuenta los OWNER dentro de ese mismo bloqueo: dos solicitudes concurrentes no pueden dejar a la empresa sin propietario.

Las invitaciones se aceptan una sola vez, con sesión verificada del email destinatario. El token de 32 bytes aleatorios solo se almacena como SHA-256. Una membresía existente no se eleva automáticamente al aceptar una invitación. La cookie activa se revalida en cada lectura: revocar una membresía invalida el acceso en la próxima solicitud.

El cliente hace una navegación de documento completa después de login, logout, aceptación de invitación o cambio de empresa para descartar el cache del router de la identidad/empresa anterior. La autorización sigue estando en el servidor.

## Worker e integraciones futuras

El worker Node independiente con Redis/BullMQ sigue pendiente. Las futuras tareas largas se encolarán con idempotencia y límites por tenant, sin depender de la vida de un request Vercel. No se incorporaron OpenAI, Meta, conversaciones operativas, CRM, pagos o métricas reales. No se crearon microservicios.

## Entornos

Compose sirve únicamente para desarrollo y pruebas locales, con volúmenes y puertos separados. El runner restringe la base de pruebas a la instancia local monzo_test en el puerto 55433. En Vercel se requieren PostgreSQL gestionado, SMTP y secretos propios de cada entorno. La autenticación nunca usa una contraseña de muestra como sustituto de configuración faltante. La rama de desarrollo no se envía a `main` automáticamente.
