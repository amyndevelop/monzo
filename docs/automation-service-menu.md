# Menú automático de servicios y precios

El usuario priorizó menús y reglas para responder consultas de servicios/precios. Se pospone el desarrollo de adjuntos de Evolution. El vínculo QR, intercambio real de texto y persistencia después de reiniciar Evolution/gateway ya fueron confirmados por el usuario en el Preview; esto no demuestra todavía una respuesta automática real.

## Alcance

Se reutilizan el constructor visual, simulador, publicación por número, motor de conversación, cola durable de Evolution y control de atención humana. El importador nuevo transforma una lista CSV en pasos editables: categorías → servicios → precios completos de cada paquete → consulta con el equipo. La opción MENÚ vuelve al inicio y la derivación se mantiene hasta una reanudación explícita. No utiliza IA, crea pedidos ni valida pagos.

Los datos comerciales se importan en la empresa del usuario; el producto no contiene servicios, precios ni reglas exclusivas de BOOSTIFY. El catálogo que el usuario aportó como imagen se transcribió en un archivo descargable fuera del repositorio, para revisar/importar. Contiene 83 paquetes, diez servicios y tres categorías. Los importes se interpretan en ARS por el contexto comercial previo. La transcripción todavía requiere revisión del propietario antes de publicar.

## Preparación desde MONZO

1. Abrir el Preview actual → Automatizaciones y seleccionar el número QR conectado.
2. Pulsar **Crear menú de servicios y precios** e importar el CSV. El archivo se procesa en el navegador, con límite de 128 KB; no se carga a un proveedor externo.
3. Revisar los contadores y desplegar las categorías para comprobar cada cantidad y precio del paquete. El importador rechaza encabezados incorrectos, campos incompletos, cantidades/importes ambiguos, paquetes duplicados, monedas mezcladas y listas que excedan los límites reales del motor. No descarta filas ni trunca precios para acomodarlos.
4. Ajustar la bienvenida y pulsar **Preparar borrador**. Si ya existe uno, se exige marcar su reemplazo. No cambia la versión publicada ni guarda/activa automáticamente. Cancelar conserva los campos locales y el flujo anterior.
5. Probar el recorrido en el simulador, guardar el borrador y revisar antes de publicar. La publicación requiere propietario/administrador y canal/procesador disponibles.
6. Si se usa el chat que ya se atendió manualmente durante las pruebas, abrirlo y pulsar **Reanudar flujo**. Publicar no reactiva conversaciones bajo atención humana ni envía mensajes por sí solo. Después enviar un texto nuevo desde el número personal para iniciar el menú.

Los precios se guardan como texto en el flujo publicado. Para cambiarlos, importar la lista corregida o editar sus pasos, guardar y volver a publicar. Este incremento no presenta esa copia como un catálogo dinámico conectado a pedidos o facturación.

## Formato

CSV UTF-8, con punto y coma (también se acepta coma como separador) y estos encabezados:

```csv
categoria;servicio;cantidad;precio;moneda
```

La cantidad es un entero sin separadores. El precio es el total del paquete, positivo, sin símbolo ni separadores de miles, con hasta dos decimales. La moneda usa tres letras mayúsculas y es única por menú; no se realizan conversiones. Se admiten hasta 250 filas, nueve categorías y nueve servicios por categoría, respetando además el máximo global de treinta pasos y novecientos caracteres por mensaje. Una lista puede alcanzar el límite de pasos/mensaje antes que el de filas; en ese caso se muestra el motivo.

## Implementación y validación

`service-menu.ts` valida/importa el CSV y genera un FlowGraph común. No agrega tipos especiales al runtime ni cambia las migraciones. `ServiceMenuBuilder` presenta carga, revisión completa, error recuperable, reemplazo explícito y preparación del borrador dentro del panel del constructor. La lista local se conserva al cerrar/reabrir el panel y los errores conservan la bienvenida. Se selecciona inicialmente un número habilitado cuando existe uno. La ayuda del flujo publicado enlaza al chat y explica cuándo reanudar.

El aviso temporal de reanudación se liga a la conversación y al estado correspondiente: se oculta cuando el flujo ya avanzó o pasó a atención humana. No sigue anunciando una próxima respuesta automática después de una pausa desde el teléfono.

Después de esa corrección también pasaron de nuevo los dos recorridos completos del bot y las dos pruebas específicas del control de atención humana, en escritorio/móvil, con un build nuevo.

No requiere nuevas variables de entorno, migraciones de Neon o reconstrucción del VPS: las respuestas salen por el despachador de texto ya instalado. La actualización del Preview debe estar Ready antes de buscar el botón nuevo. No integrar Production/main por este incremento.

La comprobación de navegador usa el proveedor local controlado: importación y revisión, simulador, publicación real por API, chat previo pausado, reanudación, menú numérico sin duplicados, precios del paquete, derivación y pausa al responder desde el teléfono. Los webhooks, firmas, gateway, PostgreSQL y aplicación son reales de pruebas; no se presenta ese proveedor como WhatsApp real. La respuesta automática física queda pendiente hasta que el propietario publique y la pruebe desde su número personal.

Verificación aprobada: cuatro pruebas del importador/compilador, ocho recorridos de Evolution en escritorio/móvil (incluida la automatización completa), cincuenta pruebas existentes de constructor/automatizaciones/variables, build Webpack, lint y tipos. Se revisaron capturas de escritorio y móvil, foco, cancelación, errores recuperables y una confirmación de reemplazo nueva en cada apertura. El archivo comercial completo también se recorrió con el motor: los 83 paquetes están presentes en quince pasos válidos y los diez servicios derivan a atención humana. Las capturas y archivos comerciales permanecen fuera de Git.

```bash
node --import tsx --test --test-isolation=none scripts/test-service-menu.mts
node --import tsx scripts/test-evolution-browser.mjs
npm test -- tests/automations.spec.ts tests/automation-workspace.spec.ts tests/dynamic-variables.spec.ts
```
