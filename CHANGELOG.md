# Cambios de MONZO

## 0.2.0 · Variables dinámicas en automatizaciones

Catálogo de variables por empresa, ocho tipos, valores predeterminados, selección y múltiples asignaciones desde opciones, inserción al cursor y vista previa. Nuevo paso Asignar variable y condiciones tipadas. Confirmación y corrección sin reiniciar el recorrido, con protecciones contra bucles y un motor compartido por simulador y WhatsApp.

La migración 202610310001_dynamic_variables agrega AutomationVariable y registra identificadores de capturas heredadas. Los valores siguen aislados por conversación/ejecución. Se conservan las publicaciones anteriores y los datos existentes. Aplicar la novena migración antes de publicar 0.2.0. Alcances de contacto/conversación quedan para entregas futuras; este MVP usa ejecución.

La versión previa del paquete era 0.1.0. Esta entrega incrementa la versión menor con funcionalidades compatibles; no crea automáticamente un tag o release externo.
