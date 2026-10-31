# MONZO 0.2.0 · Variables dinámicas

## Análisis inicial

Se revisaron modelos Tenant, Conversation, Contact y AutomationFlow, el constructor, el simulador, el ingreso idempotente por webhook y el envío por BullMQ/QStash. WhatsApp es el único canal operativo. Los pasos y conexiones viven en JSON draft/published por número; los valores de fase 8 vivían en automationState de la conversación. Ya existían captura de texto, interpolación {{nombre}} y condiciones simples. Los límites relevantes eran 30 pasos, 10 opciones, 20 caracteres por opción, 120 por captura y 900 por mensaje. Se reutilizaron acceso, transacciones, editor visual, canal, outbox, idempotencia y controles humanos.

## Uso

1. En Automatizaciones, abrí **Variables**. También podés preparar el catálogo antes de conectar un número. **+ Nueva variable** permite nombre, identificador, tipo, descripción, predeterminado opcional y moneda ISO cuando corresponde. Identificador: letra minúscula inicial, letras/números/guion bajo, hasta 40 caracteres; sin espacios ni nombres reservados constructor/prototype. Hay hasta 100 variables por empresa. La edición conserva el formulario ante errores. Duplicar abre una copia editable con identificador nuevo; eliminar exige que no haya referencias.
2. En **Pregunta con opciones** o **Guardar respuesta**, elegí **Guardar respuesta en variable**. También podés crearla con **+ Nueva variable sin salir**; queda seleccionada en ese paso. En un menú se guarda el texto de la opción por defecto. En **Guardar valores de opción**, configurá otro valor y hasta cinco asignaciones adicionales, cada una con variable, operación y valor/origen. Así una opción puede guardar cantidad, precio y servicio antes de avanzar.
3. En los mensajes de preguntas, capturas, respuestas finales y derivaciones, usá **{ } Insertar variable**. El selector muestra nombre, identificador, tipo y descripción. Inserta en el cursor y restaura el foco. La vista previa acepta valores de ejemplo locales y señala referencias sin definir. La sintaxis sigue siendo `{{identificador}}`; una variable puede repetirse y se conservan los saltos de línea. Esta inserción pertenece a automatizaciones; el compositor manual y los parámetros oficiales de plantillas conservan su funcionamiento.
4. **Asignar variable** ejecuta hasta diez operaciones en orden: asignar/reemplazar, limpiar o copiar otra variable, y continúa sin enviar mensajes intermedios. Las asignaciones de una opción se validan en conjunto antes de aplicar su resultado. La limpieza deja un valor vacío explícito y conserva los otros valores.
5. **Evaluar condición** ofrece operadores según el tipo: igualdad/diferencia, orden numérico/temporal, contiene/no contiene en texto y URL, vacío/no vacío y verdadero/falso. Primer destino: Sí; segundo: No. Se validan tipos sin evaluar código, expresiones JavaScript, fórmulas ni URLs.
6. Para confirmar datos, agregá un menú con el resumen y dos opciones: **Sí, continuar** hacia el destino final y **No, modificar** hacia la pregunta a corregir. Las demás variables se conservan y los mensajes posteriores usan el último valor válido. No se reinicia la conversación ni es obligatorio escribir MENÚ.
7. **Cargar ejemplo de variables y confirmación** crea las definiciones faltantes y carga un borrador ficticio: red social → servicio → cantidad → confirmación → asignaciones → mensaje final. No activa ni publica el árbol. Reutiliza identificadores compatibles o usa un identificador alternativo si existe otro tipo. Los valores/precios son ejemplos editables; no hay reglas de BOOSTIFY en el motor. La estructura también se entrega en docs/examples/variables-confirmation.json.
8. Guardá el borrador, probá el recorrido en el simulador y luego publicá. Los cambios del catálogo no alteran la publicación actual: cada versión conserva su definición de variables. Para usar los cambios en WhatsApp se debe publicar otra versión.

## Tipos y valores

Texto (una línea hasta 120 caracteres), entero, decimal, moneda, booleano, fecha, fecha/hora y URL http/https sin usuario/contraseña. Números sin separadores de miles; decimal con punto o coma y hasta seis decimales, hasta 15 dígitos enteros. Se normalizan y comparan con precisión decimal entera escalada, sin redondeo binario. Moneda usa código ISO configurable y salida exacta «15400 ARS», sin conversión de divisas ni redondeo silencioso. Booleanos aceptan Sí/No, true/false o 1/0 y se muestran Sí/No. Fechas reales AAAA-MM-DD; fecha/hora ISO con zona, normalizada a UTC. URL se valida y almacena: nunca se visita. La comparación de URL respeta mayúsculas en la ruta; texto ignora tildes y mayúsculas.

Los escalares se almacenan como cadenas canónicas con definición de tipo para conservar compatibilidad y precisión. Por ejemplo, cantidad es un entero tipado aunque su representación JSON sea «1000». Un número de pedido con ceros iniciales debe configurarse como Texto.

Predeterminados se aplican al comenzar una ejecución. Limpiar no vuelve a cargar un predeterminado; vacío y no definido se pueden evaluar. La validación de publicación exige capturar/asignar toda variable que se use en un mensaje o comparación de valor en todos los caminos previos. Vacío/no vacío puede comprobar una variable declarada que todavía no tenga valor. No se reemplazan valores inexistentes por contenido de otro cliente. Una sustitución nunca evalúa el resultado otra vez ni ejecuta código. Ante datos inesperados o una expansión mayor a 900 caracteres, se conserva el contexto y se deriva con un mensaje seguro al equipo, con motivo privado visible en el chat; no se corta texto silenciosamente.

## Persistencia, compatibilidad y concurrencia

AutomationVariable guarda la definición por tenant, con identificador único, alcance, revisiones y fechas. Sus cambios exigen Owner/Admin y revisión vigente, con bloqueo de Tenant y revalidación de permisos. Las referencias se revisan en todos los borradores y publicaciones de la empresa. Mientras existan, se bloquea eliminación/cambio de tipo o identificador. Nombre, descripción, predeterminado y moneda pueden editarse; requieren republicar para tener efecto. El borrador local también avisa si se intenta eliminar una variable que está usando.

Los valores están en automationState, por Conversation y versión del flujo, con runId persistido, contador y variables. Cada evento lee y actualiza ese estado en la transacción de ingreso; no depende de memoria del proceso. Mantiene deduplicación, claves compuestas de tenant/canal/contacto, generación de botones y cancelación de envíos obsoletos. Dos respuestas concurrentes se serializan y un botón de generación anterior no pisa la selección nueva. Las definiciones publicadas son instantáneas: editar el catálogo no cambia un recorrido en marcha.

No se alteran flujos publicados ni valores existentes durante la migración. Los identificadores de capturas anteriores se registran como texto. Los flujos anteriores siguen ejecutándose, incluido {{nombre}}. El editor usa schemaVersion 2 al guardar para habilitar la configuración ampliada. Se mantienen el máximo de 30 pasos y el control humano. Los ciclos con preguntas son válidos; ciclos solo automáticos y conexiones al propio paso se rechazan. Hay hasta 30 pasos automáticos por avance, 100 respuestas por ejecución y 20 respuestas/minuto por conversación en la versión 2. Flujos heredados conservan seis/minuto; continúa el límite de 30 salientes/minuto por empresa. Ante límites o tres respuestas inválidas se requiere atención humana. El simulador comparte el motor de datos/transiciones; las cuotas del transporte se aplican únicamente en el servidor.

El alcance operativo del MVP es **ejecución**. Contacto y conversación se muestran como futuros y el servidor rechaza configurarlos. MENÚ/INICIO, reanudar manualmente, nueva versión publicada o una nueva sesión tras 24 horas comienzan otro recorrido. Volver atrás mediante una opción conserva los valores. Las variables de ejecución no son un CRM ni campos permanentes de contacto. No se envían datos a Gemini ni a nuevos servicios. No almacenar contraseñas, tarjetas o secretos.

## Migración y publicación

Migración nueva: prisma/migrations/202610310001_dynamic_variables/migration.sql. Es la **novena** migración; las fases 8 y 9 no añadieron esquema. Crea AutomationVariable e importa identificadores heredados, sin actualizar conversaciones, mensajes, contactos, flujos o publicaciones.

1. Revisar PR y verificaciones. En Neon, proyecto monzo-db, rama main, base neondb, ejecutar completo docs/sql/phase-10-upgrade.sql.
2. Resultado requerido: **neondb | 1 | 12 | 9** (base, tabla_variables, columnas_variables, migraciones_aplicadas). Se puede usar phase-10-verify.sql para repetir la consulta.
3. Confirmar esa fila antes de integrar la entrega en main. El código anterior funciona con el catálogo agregado. No se publicará el código que consulta la nueva tabla antes de confirmar esta dependencia.
4. No requiere secretos o servicios nuevos. Crear/guardar/probar un flujo en el número de prueba antes de activarlo.

El generador usa los checksums exactos de las nueve migraciones. El SQL valida base, historial, columnas, restricciones e índices en una transacción. Se rechazan historiales inconsistentes y esquemas parciales; repetir una aplicación válida no sobrescribe definiciones editadas. scripts/test-phase-10-sql.mjs prueba el SQL en un neondb temporal dentro del contenedor local de test, con rollback forzado, preservación de estados/mensajes/publicaciones, importación, unicidad y FK. No accede a Neon. No se usan resets ni cambios destructivos en producción.

## Inventario principal

- prisma/schema.prisma y nueva migración; package.json/package-lock.json (0.2.0), CHANGELOG.md.
- src/modules/automations/variables.ts, variable-registry.ts, engine.ts, errors.ts y examples.ts (nuevos).
- src/modules/automations/definition.ts, core.ts, runtime.ts y service.ts (ampliados).
- Nueva API src/app/api/workspaces/[tenantId]/automation-variables/route.ts; límite JSON ampliado a 512 kB en la API de flujos para definiciones/asignaciones.
- src/components/automations/variable-manager.tsx y variable-fields.tsx (nuevos); flow-editor.tsx, simulator.tsx y src/app/globals.css (integrados).
- tests/dynamic-variables.spec.ts y tests/helpers/process-flow-event.mts (nuevos); límite de cuerpo actualizado en tests/automations.spec.ts.
- scripts/prepare-phase-10-sql.mjs, scripts/test-phase-10-sql.mjs, docs/sql/phase-10-*.sql y docs/examples/variables-confirmation.json.

Las pruebas, resultados finales y estado externo se registran también en docs/progress.md. Esta guía no presenta pruebas locales como mensajes reales enviados por Meta.

## Resultados de verificación

**196/196** pruebas generales aprobadas; repetición de **14/14** de variables con el código final de tipos, fechas históricas y comparación de URL; **18/18** QStash. Repetición final **2/2** de interfaz tras la revisión móvil, duplicado/eliminación, creación desde el paso, cambio de asignaciones e inserción con límite de 900 caracteres. Compilación webpack de publicación, validación Prisma, tipos, lint y formato aprobados. Comparación de esquema local: sin diferencias. SQL de migración validado con el script de base temporal descrito arriba.

Se revisaron capturas en escritorio y móvil del simulador y se comprobaron Escape/restauración del foco, formularios conservados al fallar y ausencia de desbordamiento horizontal. El proceso Node separado recupera el recorrido desde PostgreSQL; los eventos repetidos y opciones simultáneas conservan estados consistentes. El transporte de Meta es inyectado en pruebas: se verifica el payload resuelto sin enviar a destinatarios reales.
