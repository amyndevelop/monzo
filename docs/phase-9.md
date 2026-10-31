# Fase 9 · Analíticas operativas

El usuario eligió medir conversaciones, mensajes y resultados de flujos. La sección Analíticas obtiene agregados privados de PostgreSQL para la empresa autorizada: no consulta Meta ni Gemini, no envía contenidos a terceros y no agrega servicios, variables de entorno o migraciones. Los ocho cambios de esquema existentes son suficientes.

## Interacción

Carga inicial de los últimos siete días, períodos rápidos de 7/30/90 días y fechas personalizadas inclusivas de 1 a 90 días, sin fechas futuras. Filtro opcional por canal; también se incluye el historial de canales desconectados. La zona horaria efectiva de la empresa y la hora del informe se muestran. Actualizar o aplicar filtros obtiene otra instantánea; no hay sondeo automático.

Los filtros quedan visibles ante un fallo y se ofrece reintentar. Se ocultan las cifras anteriores mientras se consulta otro informe o cuando falla, para no confundir períodos. Los cambios pendientes en fechas/canal se indican y bloquean la exportación hasta aplicarlos. El vacío se distingue de un error y de la carga. El CSV contiene fechas y cantidades diarias, sin textos, teléfonos ni respuestas capturadas; corresponde al filtro y zona horaria mostrados en el informe. El gráfico diferencia series por color y trazo, con tabla accesible de valores exactos, teclado y diseño móvil.

## Definiciones

- **Conversaciones con actividad:** hilos distintos con al menos un mensaje registrado durante el período. No son sesiones nuevas de WhatsApp.
- **Abiertas/cerradas/sin asignar:** estado actual de esas conversaciones activas, no una reconstrucción histórica. Nuevas cuenta hilos creados en el período; reabrir un hilo no crea uno nuevo. Una conversación nueva sin mensajes también puede formar parte de Nuevas.
- **Mensajes recibidos:** registros entrantes creados en MONZO durante el período.
- **Envíos registrados:** todos los salientes creados en el período, incluidos pendientes, fallidos, inciertos y cancelados.
- **Aceptados por Meta:** estado actual SENT, DELIVERED o READ. SENT no confirma entrega. Con entrega confirmada suma DELIVERED y READ; sin lectura confirmada no significa que el destinatario no lo leyó.
- **Estado de los envíos:** cada mensaje se cuenta una sola vez en su estado actual. UNKNOWN no significa fallo; no se debe reenviar automáticamente. Los recibos posteriores pueden cambiar las cifras al actualizar.
- **Resultados de flujos:** mensajes automáticos por número, sumando versiones. Menús, preguntas de captura, mensajes finales y avisos de derivación se cuentan solo si Meta los aceptó. También se muestran pendientes, fallidos, inciertos y cancelados. No se contabilizan recorridos únicos, conversiones ni casos resueltos.

Todos los filtros temporales y la serie diaria usan **createdAt**, la fecha de registro en MONZO, no occurredAt de Meta, ni las fechas de entrega/cierre. Las columnas Prisma son timestamps sin zona almacenados como UTC: la agrupación convierte UTC a la zona efectiva antes de extraer el día. Los límites se calculan con las reglas de zona de PostgreSQL, incluyendo días de 23 y 25 horas, y se limita el extremo superior a la hora del informe. Se admiten zonas IANA y desplazamientos fijos compatibles con Intl. Una zona inválida heredada usa America/Argentina/Buenos_Aires.

## Acceso y operación

La API GET /api/workspaces/[tenantId]/analytics exige sesión verificada y membresía actual, incluidos Member. El canal debe pertenecer a esa empresa. Se rechazan parámetros desconocidos, duplicados, fechas inexistentes y rangos incompatibles. No se obtienen textos, datos del contacto, credenciales ni variables de las conversaciones. Las respuestas se entregan con no-store.

Consultas parametrizadas y agregaciones en PostgreSQL, sin cargar el historial completo en Node. Una transacción RepeatableRead mantiene coherentes los agregados entre sí; fija UTC solo dentro de la transacción, tiene timeout global de 15 s y límite de 5 s por sentencia. Se reutilizan los índices existentes por empresa; para volúmenes mayores se evaluarán índices adicionales con planes y datos reales antes de agregar una migración. No se modifica el mensaje ni se usa una reserva de cuota para generar informes.

No incluye costos de Meta/Gemini, tiempos históricos de primera respuesta, SLA, cierres históricos o tasas de resolución: el esquema actual no registra todos los eventos necesarios para afirmarlos.
