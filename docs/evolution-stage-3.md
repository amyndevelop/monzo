# Evolution · Etapa 3: QR y conversaciones

Estado al 26/11/2026: desarrollo iniciado en **feat/evolution-conversations**, desde `4f78ceb`. La Etapa 2 ya verificó la conexión técnica del VPS con el Preview de `feat/evolution-integration`. Esta rama nueva todavía no ofrece vinculación Evolution desde Canales, no modifica el stack desplegado ni el esquema de MONZO y no habilita números.

## Entorno de pruebas

El usuario indicó que no sabe si el Preview usa una base independiente. Tratar ese aislamiento como **no comprobado**: no iniciar sesión para probar escrituras, migrar ni conectar un número desde ese Preview hasta preparar una base propia. El desarrollo y las pruebas de proveedor se ejecutan localmente con servidores controlados. No usar las credenciales, cola, sesiones ni eventos de producción para probar el nuevo proveedor.

El usuario creó en Neon una rama **monzo-evolution-test**, desde `main`, seleccionando **Branch schema only**. Todavía no está comprobada su estructura ni vinculada a Vercel. En SQL Editor seleccionar explícitamente esa rama y ejecutar [la consulta de solo lectura](sql/evolution-preview-inspect.sql). Se esperan tablas públicas presentes y cero usuarios, empresas, canales, contactos, conversaciones y mensajes. El contador de `_prisma_migrations` puede ser cero porque el historial también es una tabla de datos: no ejecutar `prisma migrate deploy` sobre una copia de esquema sin revisar primero ese historial y comprobar que coincide con las migraciones del repositorio. La consulta usa una transacción de solo lectura y no inicializa historial ni cambia datos. Si la estructura no corresponde o aparece alguna fila de aplicación, detener el alta del Preview y revisar la rama elegida.

### Historial de la copia de esquema

El usuario confirmó cero usuarios, empresas, canales, contactos y conversaciones; una segunda consulta devolvió literalmente **mensajes=0; migraciones=0**. Esto confirma los contadores de esa copia, no que Vercel ya apunte a ella. Se prepara [evolution-preview-baseline.sql](sql/evolution-preview-baseline.sql), para ejecutar completo únicamente en **monzo-evolution-test / neondb**.

El bloque compara la estructura con una referencia construida localmente a partir de los once archivos originales de migraciones: relaciones, columnas/tipos/defaults, restricciones y claves, índices y enums; también detecta triggers y políticas inesperados. Excluye propietarios, OIDs y estadísticas porque no definen la estructura de la aplicación. Bloquea las tablas durante la comprobación/registro para impedir escrituras concurrentes. Si el historial está vacío, exige que **todas** las tablas de aplicación estén vacías y registra solo los once checksums originales en `_prisma_migrations`. No crea, elimina ni altera tablas de aplicación. Un historial parcial/incompatible o una estructura distinta cancelan el bloque; una repetición con historial completo correcto no escribe nada. La selección de rama se realiza en Neon: PostgreSQL no demuestra por el nombre `neondb` que el operador eligió la rama correcta.

Resultado esperado de la consulta final: **neondb | 11 | 0 | 0 | 0** (base, migraciones registradas, usuarios, empresas, mensajes). Esperar esta confirmación antes de usar Prisma para futuras migraciones de esa copia. No ejecutar el bootstrap de una base nueva sobre las tablas ya copiadas.

Generación y validación: `node scripts/prepare-evolution-preview-baseline.mjs` crea y elimina una referencia en el contenedor PostgreSQL de tests local, identificado por servicio/base/puerto antes de operar; no conecta a Neon. `node scripts/test-evolution-preview-baseline.mjs` comprueba esquema equivalente tanto desde migraciones como desde los SQL históricos de SQL Editor, registros/checksums exactos, rechazo de deriva de columnas/defaults/índices/enums/restricciones, datos operativos y registros parciales, rollback forzado después del INSERT, y repetición sin cambios. Los tests usan exclusivamente bases temporales con nombre aleatorio y conservan monzo_test/monzo_dev. Ambas comprobaciones locales pasaron; la ejecución del baseline en Neon todavía depende del usuario.

La rama de Etapa 3 tendrá su propio Preview y origen de autenticación. Los tres valores de conexión específicos de la rama de Etapa 2 no deben considerarse automáticamente disponibles en esta rama. Antes de operar habrá que preparar variables de Preview, base vacía de pruebas con sus migraciones y destino fijo del gateway. El setup de Etapa 2 rechaza un cambio de origen silencioso: preparar un cambio revisable que conserve las claves, no borrar su configuración para forzarlo. No hay cambio de destino del VPS autorizado ni realizado por este desarrollo local.

## Prueba personal y contenidos

La prueba funcional usa dos números distintos: el teléfono vinculado por QR y el número personal que actúa como cliente. Se mantiene la primera vinculación con un número secundario del plan original; el número principal de BOOSTIFY se incorpora después de validar el recorrido y su alcance de publicación. Los textos comerciales pueden redactarse desde ahora. Para Evolution se usan mensajes y flujos configurables de MONZO; no se usan las plantillas aprobadas de la API oficial de Meta. Su editor, catálogo y envíos siguen disponibles para canales Meta existentes.

Orden del piloto técnico: vincular el secundario, escribir desde el personal, recibir y responder manualmente desde MONZO, comprobar recibos y deduplicación, probar pausa por intervención humana y luego publicar un flujo sencillo con opciones numeradas. Una configuración guardada o un QR renderizado no prueban recepción ni envío reales. No cargar toda la atención comercial antes de verificar ese recorrido. Las ampliaciones del constructor corresponden a la Etapa 4 y no se anuncian como listas.

## Primer componente implementado

`services/evolution-gateway/instance-client.mjs` es un adaptador privado para los contratos de Evolution API 2.3.8, upstream `182c255ae351ff31043d7d6b872799b809338c42`. Se revisaron los controladores y rutas de instancias, las respuestas de `WAMonitoringService`, los DTO de webhook y los eventos Baileys de esa revisión.

- Deriva nombres estables por empresa, cuenta y generación; no acepta nombres de instancia o URLs arbitrarias del solicitante y no incluye teléfonos en los nombres.
- Consulta exclusivamente `fetchInstances?instanceName=...`, valida que la respuesta corresponda a esa instancia y devuelve únicamente estados permitidos. Nunca devuelve tokens, proxies, hash ni la lista de otras cuentas.
- Prepara una instancia con `qrcode: false`, sin iniciar una conexión, sin marcar mensajes/estados como leídos ni sincronizar todo el historial. El QR se solicita explícitamente.
- Prepara una configuración de eventos hacia un receptor interno fijo y distingue la credencial del proveedor de la de eventos mediante contextos HMAC distintos. **Ese receptor durable aún no está implementado**: el adaptador no está registrado como ruta, copiado a la imagen desplegada ni llamado por la aplicación.
- Verifica el teléfono de una conexión abierta contra el esperado. Una identidad ausente o distinta impide anunciar Conectado; el propietario podrá cerrar una vinculación equivocada.
- Limita respuestas y tiempo de espera, no sigue redirecciones y no reintenta mutaciones con resultado incierto. Las respuestas del proveedor no se imprimen en errores.

Este componente es una base de desarrollo; no equivale a integración completa, persistencia de comandos/eventos ni vinculación real. El gateway publicado continúa exponiendo solo el diagnóstico de Etapa 2.

## Integración pendiente

1. Persistencia durable de comandos, eventos, generaciones y deduplicación; firma y confirmación de recepción del retorno, reintentos y límites. Definir almacenamiento de adjuntos privado y acotado antes de habilitarlos.
2. Modelo/migración de cuentas Evolution sin reutilizar credenciales de Meta ni la sesión del worker Baileys existente. Las rutas y workers deben seleccionar el proveedor explícitamente.
3. Canales: preparación del teléfono por propietario, escaneo/renovación/caducidad, identidad comprobada, conexión/desconexión y recuperación. QR oculto a miembros sin permiso; abortar solicitudes al cambiar de empresa; confirmación real antes de anunciar Conectado.
4. Conversaciones: recepción/envío, recibos fuera de orden, duplicados, mensajes desde el teléfono, pausa del bot ante intervención humana y recuperación de resultado incierto. Integrar adjuntos e historial acotado con límites explícitos y conservación del compositor/borradores.
5. Persistencia/recuperación real de sesión, backups cifrados y restauración en aislamiento, dos empresas y permisos cruzados, móvil/escritorio/teclado. El número secundario solo se conecta cuando la integración durable esté completa.

UX/UI: mantener la identidad de MONZO, el chat a pantalla completa y el menú plegable. Distinguir preparación, solicitud pendiente, espera de QR, QR vencido, comprobación del teléfono, conectado y desconectado. Los errores deben conservar los datos ingresados y ofrecer una acción concreta; no mostrar credenciales o detalles de infraestructura como decisiones del usuario comercial. La recepción efectiva se confirma por el primer mensaje real y no por el estado técnico del servidor.

## Validación inicial

32 pruebas locales de probe/gateway/setup/instancias aprobadas. Las seis nuevas de instancias usan HTTP local controlado: aislamiento de nombres y rutas, preparación sin conexión automática, respuestas mínimas, identidad, QR inválidos, cierre de teléfono equivocado y resultados inciertos sin reintento. También se comprobaron formato y lint de los archivos nuevos. No se contactó WhatsApp ni se cambió Vercel, Neon, Nginx o el VPS.

```bash
node --import tsx --test --test-isolation=none scripts/test-evolution-probe.mjs services/evolution-gateway/test/*.test.mjs
```
