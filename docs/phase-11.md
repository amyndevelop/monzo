# Fase 11 · Contactos y seguimiento comercial · 0.3.0

## Alcance e interacción

Contactos se transforma en una lista compacta con búsqueda por nombre, teléfono, correo y empresa, filtro por estado comercial, mis contactos/sin asignar y etiqueta exacta. Se muestran hasta 100 coincidencias, sin presentar esa cantidad como el total de la base. Las etiquetas de una fila permiten filtrar al pulsarlas. Cada contacto conserva su identidad por empresa, número conectado y waId: no se fusionan personas de distintos números.

La ficha se abre desde Contactos o desde un botón del chat. El panel lateral comparte cierre nativo por Escape, contención del foco y retorno al control de apertura. El chat conserva su distribución de pantalla completa y su compositor. Incluye nombre comercial, correo, empresa, estado Nuevo/En seguimiento/Cerrado, responsable comercial, hasta doce etiquetas y observaciones. El nombre original de WhatsApp se conserva y se muestra en la ficha. La bandeja muestra el nombre comercial cuando existe.

El responsable y el estado comerciales son independientes del operador y del cierre de la conversación. Editar la ficha no pausa el flujo, no asigna el chat y no envía mensajes. Propietarios y administradores pueden asignar integrantes de la misma empresa. Los miembros pueden asignarse a sí mismos y liberar su propia asignación, pero no asignar a terceros ni liberar la asignación de otra persona. Un responsable que perdió acceso se identifica como anterior y no recupera permisos por seguir asociado a una ficha.

## Respuestas de los flujos

La ficha lee las variables del estado actual de la conversación del contacto. Se presentan como datos del recorrido, que pueden incluir valores predeterminados y no implican verificación humana. Cada respuesta permite completar nombre, correo o empresa, o agregar una línea a observaciones. Se pide confirmación antes de reemplazar un campo no vacío; se respetan sus límites y el correo debe ser válido. Solo Guardar ficha persiste el resultado. Reiniciar un flujo puede cambiar las variables visibles, pero no elimina los campos comerciales ya guardados.

Esta entrega incorpora respuestas con revisión del operador; no habilita el alcance contact de variables ni sincronización automática, herramientas externas, campañas, calendario, oportunidades con importes, múltiples negocios por persona o IA.

## Permisos, edición y recuperación

GET/PATCH y filtros requieren sesión verificada y pertenencia a la empresa. Las escrituras validan origen, JSON estricto y tamaños. La autorización se vuelve a verificar dentro de la transacción bajo bloqueo de Tenant; no se aceptan contactos ni responsables ajenos. Las revisiones comerciales evitan que dos ediciones se sobrescriban. Los cambios de nombre del perfil de WhatsApp no alteran la revisión comercial ni el nombre elegido por el operador.

Una falla conserva el formulario. Un conflicto informa que hay otra revisión y permite recargar con confirmación explícita del descarte. Cerrar un panel con cambios pide confirmación; abandonar la página también advierte. Los campos se deshabilitan mientras se guarda, para evitar perder cambios realizados durante la petición. Carga, vacío, error y reintento son visibles.

## Migración y publicación

La migración 202611020001_contact_follow_up agrega ocho columnas a Contact: crmName, email, company, salesStage, tags, ownerUserId, profileNotes y crmRevision. Incluye índices y restricciones de estado/responsable. Los registros existentes comienzan en Nuevo, sin responsable ni etiquetas; los nombres, mensajes, credenciales y publicaciones no cambian. La relación al usuario no reemplaza la comprobación de pertenencia a la empresa.

Ejecutar docs/sql/phase-11-upgrade.sql completo en neondb antes de integrar el código a producción. El bloque es atómico, comprueba las nueve migraciones anteriores con sus checksums originales, registra la décima y admite repetición sin sobrescribir fichas. Resultado esperado: neondb | 8 | 10. Se puede verificar después con phase-11-verify.sql. No se aplicó ninguna operación en Neon desde el entorno de desarrollo.

El generador scripts/prepare-phase-11-sql.mjs usa los bytes originales de las migraciones. scripts/test-phase-11-sql.mjs valida en una base temporal local: rechazo de base equivocada e historial incompatible, rollback forzado, preservación de contactos/conversaciones/mensajes, restricciones, valores iniciales y repetición que conserva ediciones. La aplicación anterior puede seguir funcionando después de agregar estas columnas; el código nuevo requiere el esquema nuevo.

## Verificación de la entrega

Compilación webpack, tipos, lint, formato, validación Prisma y comparación del esquema local aprobados. Diez pruebas nuevas de API/interfaz aprobadas en escritorio y móvil. Suite general: 209/210 en la primera pasada; una prueba previa de aislamiento no llegó a sus aserciones porque el alta del usuario agotó el tiempo de transacción local (5 s). Su repetición aislada aprobó en 844 ms sin cambios de código. Los diez casos nuevos aprobaron también dentro de la suite general.

Capturas revisadas de lista, ficha y acceso desde el chat a 1366 × 700 y en móvil. Los tests verifican ausencia de desbordamiento horizontal, compositor visible, guardado, búsqueda/filtros, permisos, revisiones concurrentes, respuestas incorporadas, datos conservados al reiniciar el flujo, fallos de red, recuperación y cierre/foco. El SQL regenerado pasó la prueba de migración temporal local.
