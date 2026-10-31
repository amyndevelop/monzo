# Fase 8 · Respuestas, variables y condiciones

El usuario eligió ampliar los árboles de la fase 7. Se agregan dos pasos: **Guardar respuesta** solicita un texto de 1 a 120 caracteres en una línea; **Evaluar condición** decide entre Sí y No sin enviar un mensaje adicional. Las comparaciones disponibles son igualdad, contiene y tiene valor; ignoran mayúsculas y tildes.

Una variable usa letras minúsculas, números y guion bajo, comienza con letra y tiene hasta 40 caracteres. En mensajes se inserta como `{{nombre}}`. La publicación exige que toda variable leída se haya capturado previamente en todos los caminos posibles. Se conservan los límites de 30 pasos y árbol sin ciclos. Las sustituciones se limitan a 900 caracteres y se muestran igual en el simulador y WhatsApp.

Las respuestas quedan en el estado JSON de la conversación, dentro de su empresa y número. El equipo puede consultarlas desde «Respuestas guardadas» en el chat. No son campos permanentes del contacto: MENÚ/INICIO, reanudar desde atención humana, cambiar la versión publicada o iniciar otra sesión tras 24 horas reinician las variables. No se envían a Gemini ni a integraciones externas. No solicitar contraseñas, tarjetas ni datos sensibles. No hay migración ni variables de entorno nuevas; se reutilizan las ocho migraciones existentes.

El primer mensaje inicia la pregunta, no se captura como respuesta. Los botones antiguos no se aceptan como texto de captura. Tras tres respuestas inválidas se deriva al equipo; se conservan idempotencia, versión, ventana de atención y límites de envío de fase 7. Pausar o responder manualmente conserva el estado para revisión; reanudar comienza un recorrido nuevo.

El editor conserva el borrador ante errores y explica sintaxis, destinos, validaciones y límites. El simulador permite introducir respuestas ficticias y ejecuta las mismas comparaciones y sustituciones del servidor, sin enviar mensajes. Prueba sugerida: guardar nombre, guardar consulta, evaluar si contiene «horario», responder «{{nombre}}, abrimos de 9 a 18» o derivar al equipo.
