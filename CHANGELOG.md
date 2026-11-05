# Cambios de MONZO

## 0.4.0 · WhatsApp por QR con Baileys

Conector opcional desde Canales y servicio Docker persistente para Ubuntu/VPS. Sesión y QR cifrados, permisos por empresa, estado real y recuperación tras reinicio. Recepción/envío de texto y árboles con opciones numeradas; contactos, notas y analíticas comparten la bandeja existente. Las conexiones QR no ofrecen plantillas ni adjuntos de Meta. No importan historial previo ni grupos.

Requiere la undécima migración y el servicio instalado en el VPS. El SQL combinado incluye la migración pendiente de Contactos. Conexión no oficial; puede desconectarse o sufrir restricciones de WhatsApp. Ver docs/whatsapp-qr-deploy.md. La publicación y la prueba real de vinculación están pendientes.

## 0.3.0 · Contactos y seguimiento comercial

Ficha accesible desde Contactos y desde el chat, con nombre comercial, correo, empresa, etiquetas, responsable y estado comercial. Lista con búsqueda y filtros. Incorporación revisada de respuestas de flujos a los campos de la ficha. Control de revisiones, conservación del borrador y recuperación de errores. El seguimiento comercial es independiente del operador del chat y de las automatizaciones.

Requiere la décima migración, 202611020001_contact_follow_up, antes de publicar. Ver docs/phase-11.md.

## 0.2.1 · Constructor de automatizaciones compacto

Árbol y editor en paneles con desplazamiento independiente, acciones siempre visibles, búsqueda de pasos y catálogo de variables lateral. En móvil se alterna entre árbol y edición. Ejemplos, ayuda y opciones avanzadas se despliegan a pedido. Se conservan borradores, validación y publicación existentes. Sin migraciones nuevas.

## 0.2.0 · Variables dinámicas en automatizaciones

Catálogo de variables por empresa, ocho tipos, valores predeterminados, selección y múltiples asignaciones desde opciones, inserción al cursor y vista previa. Nuevo paso Asignar variable y condiciones tipadas. Confirmación y corrección sin reiniciar el recorrido, con protecciones contra bucles y un motor compartido por simulador y WhatsApp.

La migración 202610310001_dynamic_variables agrega AutomationVariable y registra identificadores de capturas heredadas. Los valores siguen aislados por conversación/ejecución. Se conservan las publicaciones anteriores y los datos existentes. Aplicar la novena migración antes de publicar 0.2.0. Alcances de contacto/conversación quedan para entregas futuras; este MVP usa ejecución.

La versión previa del paquete era 0.1.0. Esta entrega incrementa la versión menor con funcionalidades compatibles; no crea automáticamente un tag o release externo.
