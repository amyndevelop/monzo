# WhatsApp por QR · Instalación en Ubuntu con Docker

## Qué está preparado

Servicio Node persistente con @whiskeysockets/baileys 7.0.0-rc14 (MIT, versión preliminar fijada en el lock). Vercel sigue sirviendo MONZO. Un contenedor en el VPS mantiene la conexión de WhatsApp como dispositivo vinculado. No cobra tarifas de Meta; el costo del VPS y su operación siguen a cargo del administrador. La conexión es no oficial y puede desconectarse o provocar restricciones del número.

Primera entrega: conversaciones individuales nuevas, recepción/envío de texto desde MONZO, confirmaciones del proveedor y árboles con opciones numeradas. La ficha comercial, notas y analíticas usan el mismo historial. No importa el historial anterior, grupos, estados, newsletters, reacciones ni mensajes enviados desde el teléfono. Los adjuntos entrantes aparecen como contenido no disponible; todavía no se descargan. En estos canales están bloqueados los adjuntos salientes y las plantillas Meta. Los textos recibidos que excedan 4096 caracteres se truncan con un aviso explícito.

Los canales Meta existentes conservan su proveedor, autorización e historial. Los números QR se crean como cuentas distintas y no fusionan contactos o conversaciones de otro canal. No se activa ningún número automáticamente.

## Orden de instalación

1. En Neon → SQL Editor → **neondb**, ejecutar **todo** `docs/sql/phase-12-upgrade.sql`. El bloque comprueba las nueve migraciones originales, agrega la décima de Contactos si falta y aplica la undécima para QR en la misma transacción. Es repetible y conserva credenciales, mensajes, publicaciones y fichas existentes. Resultado esperado: **neondb | 1 | 15 | 11**. La verificación aislada está en `phase-12-verify.sql`.
2. Con el esquema confirmado, integrar los cambios de Contactos y QR y verificar los despliegues de Vercel. No publicar el código que necesita columnas nuevas antes de migrar.
3. En el VPS, obtener la misma revisión del repositorio desplegada en MONZO. Antes de integrar, la rama de preparación es `feat/whatsapp-qr`; para operación usar la revisión publicada.
4. Desde la carpeta del repositorio preparar las variables y arrancar el contenedor:

```bash
cp .env.qr.example .env.qr
chmod 600 .env.qr
nano .env.qr
docker compose -f compose.qr.yaml up -d --build
docker compose -f compose.qr.yaml logs --tail=30 whatsapp-qr
```

Editar `.env.qr` directamente en el servidor. `DATABASE_URL` debe apuntar a la misma base Neon de MONZO, con TLS. Reutilizar **exactamente** la `WHATSAPP_ENCRYPTION_KEY` existente en Vercel; es una clave hexadecimal de 64 caracteres. Conservarla para recuperar las sesiones después de un reinicio. Guardar copias de seguridad de la clave de forma privada junto con el plan de recuperación de la base. Nunca pegar claves, contraseñas, el QR ni el archivo de variables en el chat, Git o logs públicos.

El contenedor no publica puertos ni instala otra base/Redis. Necesita acceso saliente a PostgreSQL y a los servicios de WhatsApp, y una hora del sistema correcta. El Dockerfile copia solo código y dependencias; excluye archivos `.env`. Se ejecuta como usuario sin privilegios, con sistema de archivos de solo lectura y `/tmp` efímero. La sesión persiste cifrada en PostgreSQL, no en una carpeta de credenciales de texto plano del VPS. La imagen permite una CA opcional de build mediante el secret `proxy_ca` cuando la infraestructura usa un proxy TLS; en un VPS normal no se configura ese secret.

## Vincular el teléfono

Entrar como propietario de la empresa en **Canales → Conectá WhatsApp por QR**. Si aparece el servicio disponible, preparar un nombre y el teléfono en formato internacional, solo dígitos. Presionar Vincular por QR. En el teléfono: WhatsApp → Dispositivos vinculados → Vincular dispositivo. Escanear el QR y esperar el estado **Conectado**. El teléfono debe coincidir con el número preparado; una diferencia detiene y desvincula el intento. El QR caduca y se renueva; solo se entrega a propietarios de esa empresa.

La confirmación del estado proviene del servicio. Una solicitud guardada o un contenedor iniciado no demuestran una vinculación real. Para la prueba, recibir un texto desde otro teléfono, responder desde MONZO y verificar la recepción. Después publicar un flujo de prueba con opciones numeradas, recorrerlo desde el otro teléfono y probar derivación al equipo. Estos pasos requieren un número de pruebas real y todavía no se ejecutaron desde el entorno de desarrollo.

## Operación y recuperación

```bash
docker compose -f compose.qr.yaml ps
docker compose -f compose.qr.yaml logs --tail=50 whatsapp-qr
docker compose -f compose.qr.yaml restart whatsapp-qr
```

Reiniciar el contenedor conserva la sesión cifrada; puede requerir un nuevo QR si WhatsApp revocó el dispositivo. Una desconexión solicitada en MONZO deshabilita envíos, cancela los pendientes no reclamados y solicita cerrar sesión en el servicio. Si el servidor está apagado, la solicitud queda pendiente hasta que vuelva. También puede revocarse el dispositivo desde WhatsApp en el teléfono. Mensajes ya reclamados/en vuelo pueden haber salido y no se anuncian como cancelados.

El worker renueva su heartbeat y la concesión de cada sesión. Una sesión solo tiene un propietario de concesión; los callbacks comprueban generación y concesión para no escribir estado obsoleto. Los QR y la autenticación están cifrados con AES-GCM y contexto de empresa/cuenta. El número de una sesión QR activa no puede vincularse simultáneamente en otra empresa. Se admiten hasta tres preparaciones por empresa en este MVP.

Recepción y salida reutilizan aislamiento, idempotencia, permisos y el motor de flujos existente. La cola QR se procesa en el VPS; los trabajos de Meta conservan su transporte actual. Los canales QR no aplican la ventana de plantillas Meta. Los menús salen como texto numerado. En caso de resultado incierto de envío, el mensaje queda Sin confirmar y no se reenvía automáticamente. Un reinicio durante un envío tampoco provoca una repetición automática. Los logs de la biblioteca están silenciados; el servicio registra solo categorías operativas.

## Límites de verificación

Las pruebas automatizadas usan una conexión Baileys inyectada y transportes falsos explícitos: verifican protocolo de integración, aislamiento, cifrado, identidad, historial excluido, duplicados y resultados inciertos. No prueban conectividad real con WhatsApp ni garantizan continuidad ante cambios del protocolo. La versión de Baileys requiere seguimiento y actualizaciones revisadas. El despliegue real depende del VPS y de la migración de Neon; no se accedió a esos sistemas desde el entorno de desarrollo.

## Verificación de esta entrega

218/218 pruebas generales y 12/12 específicas de QR aprobadas; compilación webpack y tipos aprobados. Las capturas de Canales y de la bandeja QR se revisaron en escritorio y móvil. El SQL combinado pasó la prueba local de migración. La imagen Docker se construyó con sus dependencias mínimas y worker compilado; el arranque de un contenedor de prueba se bloqueó por falta de disco en el almacenamiento VFS del entorno. Se liberaron la caché y la imagen local para conservar el espacio, sin borrar volúmenes. El despliegue y el QR real siguen pendientes en el VPS del usuario.
