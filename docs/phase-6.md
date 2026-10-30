# Fase 6 · Gemini gratuito: laboratorio de agentes

## Primera entrega autorizada

El usuario eligió Gemini gratuito para pruebas después de confirmar catálogo y envío
real de plantillas de Fase 5. Se implementa un laboratorio por empresa en Agentes IA:
nombre, instrucciones, conocimientos de texto ficticios, pausa, límite diario y una
pregunta de prueba por solicitud. El resultado es texto revisable y no se envía a
WhatsApp, no se guarda como Message y no dispara tareas. No se lee automáticamente
ningún historial, contacto, teléfono, nombre de usuario o nota interna para Gemini.
El contexto contiene exclusivamente nombre del agente, instrucciones, conocimientos
y pregunta introducidos manualmente. No admite conversationId en la API.

Las condiciones actuales del nivel gratuito indican que Google usa entradas y salidas
para mejorar productos y puede recurrir a revisión humana; no deben enviarse datos
personales, confidenciales ni sensibles. Por eso esta primera entrega se limita a
ensayos ficticios. La UI explica el destino de los datos y exige confirmación expresa
por prueba. No es un detector automático de información personal ni promete anonimato.
La asistencia con historial real, el envío automático, RAG, carga de archivos,
transcripción, herramientas, facturación y escalamiento automático quedan pendientes.
La atención humana actual de WhatsApp no se modifica.

Fuentes oficiales consultadas el 30/10/2026:

- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/terms
- https://ai.google.dev/api/generate-content

## Modelo, clave y costos

Se fija `gemini-3.5-flash-lite`, disponible en Standard gratuito según la tabla
consultada. Los modelos 2.5 tienen acceso limitado para proyectos nuevos según
https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite y no se usan como
opción inicial. No se cambia automáticamente a otro modelo, no se usan grounding,
búsqueda, herramientas, caché de contexto ni reintentos automáticos.

Crear la clave en https://aistudio.google.com/api-keys con un proyecto del nivel
gratuito **sin facturación activada**. Configurar `GEMINI_API_KEY` exclusivamente en
las variables de servidor de Vercel Production del proyecto utilizado. No anteponer
NEXT_PUBLIC_, no ponerla en el chat ni en el repositorio. Si se usan ambos proyectos
monzo y monzo-v, configurar cada uno y volver a desplegar para aplicar cambios.
La aplicación comprueba presencia, no validez, nivel de facturación ni cuota del
proyecto de Google. Los límites locales no garantizan saldo gratuito: eso depende
de Google y de la configuración del proyecto.

Las lecturas y la edición del agente están disponibles sin clave. El botón de prueba
queda deshabilitado con explicación hasta configurar el servidor. El primer intento
real confirma acceso a la clave/modelo, sin confundirlo con mera configuración.
No se ha realizado ninguna llamada real desde este entorno ni se solicitó la clave.

## Límites y aislamiento

Una tabla AiAgent por tenant, relación Restrict y revisión optimista al editar. Solo
OWNER/ADMIN pueden guardar, habilitar o pausar; cualquier miembro actual puede probar
el agente guardado. Cada endpoint exige sesión verificada y acceso al tenant; las
mutaciones requieren origen exacto, JSON acotado y esquema estricto. El rol se
revalida bajo bloqueo de la empresa. Una edición simultánea no sobrescribe silenciosamente
los cambios ajenos. Una pausa, revisión nueva o revocación durante HTTP invalida la
respuesta antes de entregarla al usuario.

Las reservas de cuota se serializan con advisory lock transaccional global, luego
bloqueo de tenant, sin mantener locks durante HTTP. Reutilizan RateLimit: máximo
configurable entre 1 y 50 intentos/día por tenant (inicial 20), 3 por minuto/tenant,
100 por día y 10 por minuto compartidos por la instalación. Todos los contadores se
reservan en una transacción o se revierten juntos. Los fallos posteriores de Gemini
consumen intento porque pueden haber consumido cuota del proveedor. Día UTC y próximo
reinicio mostrado explícitamente en hora argentina. Los límites de Google pueden ser menores.
La UI muestra intentos, no tokens ni importe facturado.

Entrada máxima: instrucciones 3000 caracteres, conocimientos 10000, pregunta 2000,
nombre 80; salida solicitada 700 tokens y texto aceptado hasta 4000 caracteres. Endpoint
HTTPS fijo, clave en header, redirects rechazados, timeout de 20 segundos y lectura
acotada a 64 KiB. No se exponen mensajes libres ni cuerpos de error del proveedor.
Resultados bloqueados, truncados o sin texto se comunican como fallo, no como respuesta
completa. Pruebas contra monzo_test bloquean la red real salvo transporte explícito.

## UX/UI

Dos paneles adaptables: configuración y laboratorio. Muestran preparación de conexión,
cambios pendientes, controles de rol, carga, cuota, pausa, error y recuperación.
No se prueba una configuración sin guardar. Pregunta y configuración se conservan
ante fallos. El resultado usa texto plano, sin HTML ni enlaces ejecutables generados;
el foco pasa a su encabezado. Escritorio/móvil conservan la navegación existente.
No se modifica el chat ni su compositor para este laboratorio de datos ficticios.

## Migración y publicación

Séptima migración aditiva: `202610300003_gemini_lab`. Crea AiAgent; no cambia tablas
anteriores, no agrega secretos a la base y todos los agentes comienzan pausados.
El código nuevo debe publicarse **después** de aplicar esta migración en Neon.

1. En Neon, monzo-db / main / neondb, ejecutar TODO `docs/sql/phase-6-upgrade.sql`.
2. Confirmar resultado `neondb | 1 | 10 | 7` (base, tabla, columnas, migraciones).
3. Configurar GEMINI_API_KEY del proyecto gratuito en Vercel sin compartir su valor.
4. Integrar esta rama en main, verificar Ready de producción y abrir Agentes IA.
5. Guardar un agente habilitado con conocimientos ficticios y probar una pregunta.

`node scripts/prepare-phase-6-sql.mjs` reproduce el SQL y checksums desde los archivos
originales. DO atómico, historial previo exacto, rechazo de esquema parcial, destino
incorrecto e índices/tipos incompatibles. Repetir la verificación no cambia datos.
`node scripts/test-phase-6-sql.mjs` comprueba rollback, repetición segura, checksums,
conservación de mensajes/usuarios, unicidad y claves foráneas en una neondb temporal
exclusivamente dentro del contenedor local test-database. No se conecta a Neon.

## Verificación

`tests/ai.spec.ts` usa PostgreSQL y sesión reales para aislamiento, roles, revisiones,
confirmación ficticia, origen, límites de cuerpo y solicitudes concurrentes. Los
contratos de Gemini usan transportes inyectados y verifican carga, límites, ausencia
de herramientas, errores privados y rechazo de salidas incompletas. UI de escritorio
y móvil comprueba conexión sin clave, guardado, error de cuota, conservación de
pregunta, resultado, foco y ancho; solo el transporte IA de éxito se intercepta.
Resultados finales en docs/progress.md. La llamada real a Gemini queda pendiente de
configurar la clave en el servidor y realizar la prueba autorizada con datos ficticios.
