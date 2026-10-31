# Arquitectura · Fases 3 a 5

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

## WhatsApp y worker

La web Next.js y el proceso Node independiente comparten PostgreSQL. Redis/BullMQ ejecuta tareas sin depender de la duración de un request Vercel. `src/modules/whatsapp/service.ts` entrega DTOs autorizados y el núcleo se comparte con el worker. IA, CRM, pagos y métricas operativas siguen pendientes.

El webhook verifica HMAC sobre bytes originales y almacena eventos separados por cuenta/empresa antes de responder 200. El dispatcher consulta pendientes cada tres segundos. Cada transacción procesa como máximo 25 mensajes o 50 estados; bloquea evento y empresa, deduplica por ID de Meta, crea contacto/hilo y vacía el payload procesado. Hay ocho intentos con espera exponencial y reencolado manual por OWNER.

Los envíos se guardan QUEUED con UUID idempotente. Antes de HTTP, el worker revalida membresía, cuenta y ventana de 24 horas y reclama SENDING bajo bloqueo. Duplicados no repiten registros reclamados. Solo QUEUED puede recuperarse de un job fallido. Una interrupción después de reclamar pasa a UNKNOWN; no se reenvía automáticamente. Los recibos firmados reconcilian por ID de Meta o `biz_opaque_callback_data`, sin retroceder SENT/DELIVERED/READ.

La tercera migración agrega WhatsappAccount, Contact, Conversation, Message, ConversationNote, WhatsappWebhookEvent y WorkerHeartbeat, conservando las dos anteriores. Relaciones compuestas impiden cruzar cuenta/contacto/hilo/empresa. Los tokens usan AES-256-GCM con AAD de empresa/número. Heartbeat indica actividad reciente y no garantiza entrega.

La UI consulta listas cada cinco segundos e hilos cada cuatro. Historial por cursor de 50 mensajes, notas privadas y asignación a miembros actuales. Cerrar no impide recepción: un mensaje nuevo reabre, usando la precisión de segundos de Meta. Mensajes demorados anteriores al cierre no reabren. Ver límites y preparación de producción en `docs/phase-3.md`.

## Procesamiento por eventos sin servidor permanente

El modo `WHATSAPP_PROCESSOR=qstash` conserva el mismo núcleo y PostgreSQL, pero publica IDs por HTTPS a QStash. Vercel recibe `/api/jobs/whatsapp` con JWT firmado sobre cuerpo y URL exactos; la biblioteca oficial admite ambas claves de rotación. Redis y el proceso permanente no se usan en este modo.

La cuarta migración agrega `jobPublishedAt` a eventos y mensajes. La web espera aceptación de la cola; fallos dejan datos durables y un error visible, sin afirmar envío. Se solicitan dos reintentos. Un watchdog demorado marca intentos interrumpidos como UNKNOWN; el propietario puede revisar/reprogramar pendientes de su empresa. No hay polling continuo de base ni cron. Las cuotas gratuitas deben verificarse en el panel; cada entrega/reintento consume cuota. Ver `docs/phase-3.md`.

## Entornos

Compose sirve únicamente para desarrollo y pruebas locales, con volúmenes y puertos separados. El runner restringe la base de pruebas a la instancia local monzo_test en el puerto 55433. En Vercel se requieren PostgreSQL gestionado, SMTP y secretos propios de cada entorno. La autenticación nunca usa una contraseña de muestra como sustituto de configuración faltante. La rama de desarrollo no se envía a `main` automáticamente.

## Adjuntos · Fase 4

La quinta migración agrega metadatos opcionales de archivo a Message. La bandeja expone únicamente disponibilidad y metadatos; los bytes se obtienen con autorización por mensaje/empresa y se cargan a pedido. Las subidas multipart se validan por contenido y tamaño antes de llamar al endpoint de medios de la cuenta en Graph. No se mantiene un bloqueo de PostgreSQL durante HTTP: se revalida acceso/canal/ventana al guardar y al enviar. La idempotencia permite archivos sobrantes en Meta tras una carrera o fallo, pero no mensajes salientes duplicados.

Meta conserva el archivo; PostgreSQL guarda ID, MIME, nombre, tamaño y hash. No se agrega almacenamiento de objetos ni se encolan bytes. La descarga renueva el enlace de Meta, exige host/ruta HTTPS fijos sin redirecciones, comprueba tamaño/hash/tipo y vuelve a validar membresía antes de responder. La UI usa object URLs locales y conserva la selección/clave al fallar la programación. La disponibilidad depende de la retención del proveedor; no se promete archivo permanente. Ver `docs/phase-4.md` para formatos, límites y publicación antes/después de migrar Neon.

## Plantillas · Fase 5

La sexta migración agrega WhatsappTemplate por cuenta/empresa y una instantánea inmutable en Message. La sincronización explícita pagina Graph de a 50, con cursor validado y versión para rechazar escrituras obsoletas. La UI consulta el catálogo local y presenta variables y vista previa en el chat. Los encabezados de archivo reutilizan el transporte privado de adjuntos. No se añade proveedor ni secreto.

El worker consulta estado y definición en Meta antes de reclamar una plantilla. Revalida membresía, cuenta, WABA, versión de credencial y hash bajo bloqueo; entonces usa el transporte de mensajes existente. El bypass de ventana corresponde exclusivamente al tipo template validado; texto/medios mantienen las 24 horas. La instantánea conserva el historial aunque cambie el catálogo. Ver `docs/phase-5.md` para formatos, permisos, límites y actualización previa de Neon.

## Automatizaciones guiadas · Fase 7

AutomationFlow contiene borrador y publicación por número, con revisión optimista y
versión de ejecución. Conversation guarda pausa humana, generación y sesión. Message
conserva la instantánea, sourceId único y evento de origen. La recepción crea como
máximo una respuesta por mensaje bajo bloqueo de tenant; el despacho ocurre después
del commit y usa la outbox existente. El worker revalida versión, generación, rol,
cuenta y ventana antes de reclamar el envío. No hay HTTP durante las transacciones.

La intervención humana cancela respuestas automáticas no reclamadas y pausa el
recorrido. Las conversaciones previas a la migración comienzan pausadas. El editor
valida un grafo sin ciclos, el simulador es local y publicar no envía mensajes por
sí mismo. No se usan Gemini ni herramientas externas. Ver docs/phase-7.md.

### Variables del recorrido guiado

La fase 8 reutiliza automationState JSON para respuestas de hasta 120 caracteres, aisladas por conversación. Los nodos capture guardan una variable y avanzan por un destino; condition resuelve Sí/No sin generar mensajes intermedios. definition.ts comparte comparaciones y sustitución entre simulador y runtime. La validación intersecta las variables disponibles de todos los predecesores del DAG antes de permitir lecturas. Cambios de publicación, reinicio y reanudación invalidan el estado anterior. No agrega evaluación de código, llamadas externas ni uso de Gemini.

### Analíticas operativas · Fase 9

API privada de agregados por empresa/canal y período de hasta 90 días. El núcleo analytics/core.ts comparte consultas PostgreSQL parametrizadas con las pruebas; el servicio valida sesión/membresía antes de ejecutarlas. Una transacción RepeatableRead obtiene un informe coherente con fecha de registro en MONZO y zona horaria efectiva. No carga textos, credenciales ni variables capturadas. El panel cliente cancela consultas anteriores, oculta resultados durante carga/error y exporta únicamente cantidades diarias. No agrega servicios ni esquema. Definiciones y límites en docs/phase-9.md.

### Variables dinámicas · MONZO 0.2.0

AutomationVariable es el catálogo por Tenant, con unicidad de identificador, tipos, predeterminados, alcance execution, revisiones y fechas. Las publicaciones guardan instantáneas de definiciones; el runtime no consulta el catálogo para cada mensaje. El motor puro automations/engine.ts comparte validación de entradas, asignaciones, condiciones e interpolación entre simulador e ingreso real. Los valores canónicos, runId y contador persisten en automationState dentro de la misma transacción de ingreso, bajo el bloqueo de Tenant ya existente. Se mantienen source/event/generation y la cola saliente, sin HTTP en la transacción.

La validación usa asignación definida por punto fijo para permitir correcciones con preguntas; rechaza ciclos exclusivamente automáticos y variables leídas antes de estar disponibles. Cambiar el catálogo no modifica una publicación vigente. Owner/Admin gestionan definiciones con control de revisión; referencias guardadas/publicadas bloquean cambios incompatibles y eliminaciones. Contacto y conversación quedan para otros alcances futuros. Ver docs/phase-10.md para límites, migración nueve y guía.
