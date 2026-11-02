# Constructor de automatizaciones · UX 0.2.1

La página anterior obligaba a recorrer varias pantallas para encontrar las acciones, el árbol y los campos de un paso. El constructor ahora ocupa el espacio disponible y mantiene Guardar, Probar, Publicar y Variables a la vista.

En escritorio, el árbol y el editor tienen desplazamiento independiente. Buscar un paso permite seleccionarlo directamente; la edición vuelve al comienzo al cambiar de paso. Agregar paso y Ejemplos están junto al árbol. El catálogo de variables, la ayuda y los avisos se abren en paneles laterales con cierre por Escape y retorno de foco. La creación contextual de variables conserva la selección del paso.

En móvil se alterna entre Árbol y Editar paso. Seleccionar o agregar un paso abre su edición. Los controles avanzados de selección y las explicaciones se despliegan a pedido. Los campos configurados siguen disponibles; el motor, las publicaciones, los permisos y los límites no cambian. Los errores de guardado conservan el borrador.

Verificación: 200/200 pruebas generales aprobadas, sin fallos, omisiones ni reintentos. Incluyen cuatro casos nuevos de escritorio/móvil para acciones visibles, navegación, búsqueda, foco, variables y recuperación del borrador. Capturas revisadas a 1366 × 640 y en móvil. Compilación webpack, tipos y lint aprobados. Sin migraciones ni variables de entorno nuevas.
