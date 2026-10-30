# Fase 7 · Consultas guiadas y automatizaciones

## Alcance autorizado

El usuario autorizó continuar con un árbol visual de consultas/respuestas, simulador,
borradores, publicación por número y derivación a personas. No depende de Gemini ni
activa facturación de IA. Usa los canales, PostgreSQL y procesamiento actuales.

Un flujo por número de WhatsApp, hasta 30 pasos y 10 opciones por pregunta. Tipos:

- Pregunta con opciones: espera una elección y conecta a otro paso.
- Respuesta final: termina el recorrido y permite reiniciar escribiendo MENÚ o INICIO.
- Derivar al equipo: envía el texto configurado y deja la atención en manos humanas.

No incluye condiciones sobre CRM, llamadas a URLs, herramientas externas, formularios
de datos, campañas, horarios programados, cobros ni interpretación mediante IA.
No se envía una bienvenida al publicar: solo se responde a mensajes entrantes nuevos.

## Editor y publicación

Automatizaciones muestra selector de número, estado de publicación y borrador, árbol
con conexiones y editor del paso seleccionado. Incluye ejemplo editable, alta/baja de
pasos, textos y destinos. En móvil, elegir/agregar un paso enfoca el editor y permite
volver al árbol; el canvas tiene desplazamiento propio para árboles profundos.

Se pueden guardar borradores incompletos. Publicar exige nombre, inicio, títulos,
mensajes, opciones distintas y destinos existentes; rechaza ciclos y pasos huérfanos.
Los límites estructurales se aplican también al guardar (30 pasos, diez opciones,
texto de hasta 900 caracteres, etiqueta de opción de hasta 20). El simulador exige un
árbol completo, funciona localmente, no guarda datos ni envía solicitudes a Meta o IA.
Admite teclado, Escape y restauración del foco. El resultado de cada elección recibe
foco dentro del simulador.

Guardar no cambia la versión activa. Publicar y activar requiere confirmación de su
efecto y canal/procesamiento disponibles. Pausar sigue disponible sin conexión válida.
Reactivar publicado usa la última publicación y conserva cambios locales sin guardar.
Se usa revisión optimista para no sobrescribir ediciones simultáneas. Al fallar, el
borrador local se conserva; cambiar de número o recargar versión requiere decidir
si descartarlo. Al recargar una página con cambios pendientes se usa el aviso nativo.
Los borradores guardados persisten en el servidor; los no guardados no se prometen
persistentes al navegar a otra sección de la aplicación.

Solo OWNER/ADMIN editan y publican; MEMBER puede leer y simular. El número debe
pertenecer al tenant en todos los endpoints. Publicar o cambiar activación incrementa
la versión de ejecución e invalida menús anteriores. Guardar solo incrementa revisión
de borrador. No se afirma actividad del procesador basándose solo en el estado del flujo.
Si quien publicó pierde su rol autorizado, se detienen las nuevas respuestas y se
informa que un administrador actual debe volver a publicar.

## Ejecución y menús de WhatsApp

Una recepción válida genera como máximo una respuesta automática bajo el mismo
bloqueo de empresa que persiste el mensaje entrante. La combinación sourceId única
y la deduplicación del providerId impiden respuestas dobles a webhooks repetidos.
El estado pertenece a conversación, cuenta y empresa. La instantánea del mensaje
contiene texto, versión, generación y opciones de ese envío.

De una a tres opciones se envían como reply buttons; de cuatro a diez, como lista.
El selector se valida contra el menú actual mediante un ID que incluye flujo,
versión, generación, paso y opción. También se acepta el texto exacto de una opción,
sin distinguir mayúsculas/acentos, o su posición numérica. No se usa el título del
webhook interactivo para ejecutar destinos. Un ID viejo no puede saltar a un paso
arbitrario ni ejecutar un menú nuevo: se muestra el menú actual.

Después de tres elecciones no reconocidas se deriva al equipo. MENÚ/INICIO reinicia
un recorrido automático pero no libera una derivación o pausa humana. Una sesión
sin derivación se reinicia tras 24 horas de inactividad. Los mensajes anteriores a
la activación o demorados respecto del último entrante no generan respuestas.
Solo se responde dentro de la ventana de 24 horas, revalidada antes del POST a Meta.
Para iniciar o retomar fuera de ventana, se mantiene el envío humano de plantillas.

Límites: seis respuestas automáticas por conversación/minuto y 30 salientes totales
por empresa/minuto. Alcanzar un límite deja la automatización de esa conversación
pausada, con motivo visible para revisión humana; no intenta responder en bucle.
El historial identifica los mensajes automáticos y conserva sus estados reales.

Fuentes de formato: documentación de Meta y SDK alojado por Meta en
https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/interactive/ .
Las páginas actuales de developers.facebook.com devolvieron 429 durante esta sesión;
se usan límites conservadores y contratos explícitos. La entrega real de botones/listas
se confirmará con el número de prueba después del despliegue.

## Control humano

El chat incorpora Tomar atención y Reanudar flujo. Enviar texto, adjunto o plantilla,
asignar/quitar operador y cerrar/reabrir también pausa la automatización. Leer o
marcar como leído y agregar una nota interna no la pausa. Reanudar requiere flujo
activo, canal autorizado, publicador con permiso, conversación abierta y sin operador
asignado; borra la sesión para empezar con el próximo mensaje entrante, sin enviar
nada por sí solo. No borra el borrador del compositor.

Las conversaciones existentes se migran pausadas. El valor inicial de base es pausa humana, para proteger también las creaciones hechas por código anterior durante el despliegue. El manejador nuevo habilita explícitamente las conversaciones nuevas recibidas. Publicar un flujo no las activa:
el operador debe reanudarlas expresamente. Las conversaciones nuevas quedan
habilitadas para un flujo activo sin asignación humana. Derivar al equipo conserva
la conversación en la bandeja con sus no leídos; no promete asignación automática ni
notificaciones externas a otra persona.

Toda pausa/cambio de versión cancela solo mensajes automáticos QUEUED, preservando
los humanos. El worker compara flujo, versión, generación de conversación, rol actual,
canal y ventana antes de reclamar SENDING. Un mensaje ya reclamado puede terminar
su envío aunque se pause después; la UI lo explica. UNKNOWN no se reenvía de forma
automática. Se mantienen recibos monotónicos y variante argentina ante 131030.

## Cola, permisos y datos

QStash publica los IDs de respuesta y watchdog después de confirmar la transacción
de recepción. Un reintento sobre el evento DONE recupera las respuestas QUEUED para
reintentar su programación; las aceptadas no se republican durante el intervalo de
protección actual. Al agotar intentos, recuperar pendientes en Canales sigue disponible.
BullMQ conserva su dispatcher actual, que recoge los mensajes nuevos de la outbox.
No se contrata otro servicio ni se agregan secretos. Cada respuesta consume los
trabajos de la cola actual y está sujeta a cuotas y cargos del proveedor.

APIs con sesión verificada, autorización por tenant/rol, origen exacto, esquemas
estrictos y cuerpos acotados. Las relaciones compuestas impiden vincular un mensaje
al flujo de otra cuenta o empresa. No se aceptan destinatarios, scripts, URLs de
herramientas ni credenciales en el árbol. No se exponen tokens ni instantáneas de
routing en los DTOs de mensajes; el cliente ve texto y un indicador de automatización.

## Migración y publicación

Octava migración aditiva `202610300004_guided_flows`: crea AutomationFlow, agrega tres
columnas a Conversation y cuatro a Message, índices y relaciones compuestas. No
modifica migraciones anteriores ni borra conversaciones o mensajes. La actualización
inicial deja pausadas las conversaciones que ya existían; reejecutar el SQL validado
no vuelve a alterar su estado.

1. Ejecutar TODO docs/sql/phase-7-upgrade.sql en Neon monzo-db / main / neondb.
2. Confirmar **neondb | 1 | 3 | 4 | 8**: tabla, columnas de conversación/mensaje e historial.
3. Después integrar/publicar el nuevo cliente desde main y verificar Ready de Vercel.
4. Crear un árbol en Automatizaciones, guardar, simular y publicar en el número de prueba.
5. Si se usa una conversación existente, quitar asignación y pulsar Reanudar flujo.
6. Escribir desde el teléfono de prueba, elegir una opción y comprobar respuesta y
   derivación. Probar Tomar atención y que una respuesta humana pause el flujo.

El generador scripts/prepare-phase-7-sql.mjs usa bytes/checksums exactos de las ocho
migraciones. El DO es atómico, valida destino/historial y rechaza esquema parcial;
permite repetir la comprobación. scripts/test-phase-7-sql.mjs usa solo una neondb
local temporal para comprobar rollback, mensajes conservados, repetición segura,
pausa inicial, unicidad y claves compuestas. Nunca se conecta a Neon.

## Verificación

Contratos y PostgreSQL/sesiones reales en tests/automations.spec.ts: validación,
roles/aislamiento, revisión, publicación, pausa, recepción/cola, botones/listas,
duplicados, menús anteriores, derivación, límites, orden/ventana y atención humana.
UI de escritorio/móvil: borrador conservado ante fallo, simulador y foco, toma de
atención/reanudación sin perder texto ni ocultar compositor. Meta y QStash se prueban
con transportes explícitos; no hay envíos reales desde este entorno. Resultados
finales y límites de verificación en docs/progress.md.
