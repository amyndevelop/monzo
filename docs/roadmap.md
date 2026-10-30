# Roadmap

## Fase 1 · Fundación — publicada

Landing Cloud, demo, branding oficial, tokens, herramientas de calidad y esquema inicial. El logo y la mascota se preservan sin redibujar ni recolorear.

## Fase 2 · Autenticación y multiempresa — publicada

Cuentas con correo verificado, sesiones persistentes, recuperación, empresas y preferencias independientes, roles e invitaciones. La demo pública se mueve a `/demo` y `/dashboard` pasa a ser privado. La capa de acceso se comprueba con sesiones reales, PostgreSQL, correo local y pruebas cruzadas. Ver `docs/phase-2.md` y `docs/progress.md`.

Publicada desde main tras configurar Neon, Resend y secretos en Vercel. El usuario confirmó el correo externo, la cuenta verificada y la creación de una empresa con acceso al dashboard. La cobertura local y los límites de verificación en producción están registrados en docs/progress.md.

## Fase 3 · WhatsApp y atención humana — publicada

Cloud API oficial, webhook firmado, recepción idempotente, contactos, bandeja, respuestas de texto, estados y colaboración humana. Publicada en Vercel con QStash por eventos, sin worker permanente ni Redis remoto. El usuario confirmó recepción y envío reales con el número de prueba, corrigió el destinatario argentino y sustituyó el token temporal por uno de usuario del sistema. El número comercial permanece sin migrar. Ver `docs/phase-3.md`.

## Fase 4 · Adjuntos — publicada

El usuario autorizó continuar el desarrollo de la siguiente fase tras revisar su alcance. Se implementaron imágenes, audio, video y documentos, con apertura/descarga privada y envío por la cola actual. Usa almacenamiento de Meta y un límite de 3 MiB por archivo, sin servicios adicionales. El usuario confirmó la migración de Neon con neondb | 4 | 5. Publicada mediante 4f0e20e; el usuario confirmó que los adjuntos funcionan en producción. Se ajusta la presentación del chat a su pedido. Ver `docs/phase-4.md`.

## Fase 5 · Plantillas — publicada y confirmada

El usuario autorizó esta fase y estableció UX/UI como requisito permanente. Catálogo por cuenta sincronizado con Meta, selección dentro del chat, variables, vista previa, encabezados de archivo y envío fuera de las 24 horas con validación previa. El usuario confirmó la sexta migración de Neon con neondb | 1 | 2 | 4 | 6. El usuario confirmó actualización del catálogo y envío real tras asignar al usuario del sistema el acceso a Test Messaging Account, además de Test WhatsApp Account. Ver `docs/phase-5.md`.

## Fase 6 · Agentes IA con Gemini — laboratorio publicado y confirmado

El usuario eligió el nivel gratuito para pruebas. Primera entrega: laboratorio por empresa con instrucciones, conocimientos ficticios, pausa, límites de intentos y respuestas de prueba. Las condiciones de Google excluyen datos personales/confidenciales del servicio gratuito: no se carga historial real ni se responde automáticamente en WhatsApp. La asistencia con datos reales y automatización se definirán aparte. El usuario confirmó la séptima migración de Neon con neondb | 1 | 10 | 7. Publicada tras configurar GEMINI_API_KEY; el usuario confirmó una respuesta real usando conocimientos ficticios. La revisión de Gemini pago no activó facturación ni el uso de conversaciones reales. Ver docs/phase-6.md.

## Fase 7 · Automatizaciones guiadas — desarrollo autorizado

Árbol visual por número, preguntas con botones/listas, respuestas finales y derivación al equipo. Borradores separados de la publicación, simulador local, pausa y reanudación explícitas en el chat. No depende de Gemini ni activa IA paga. Las conversaciones existentes permanecen bajo control humano hasta reanudarlas. El usuario confirmó la octava migración de Neon con neondb | 1 | 3 | 4 | 8. Lista para publicar; pendiente verificar producción y un recorrido real de botones/listas. Ver docs/phase-7.md.

## Fases posteriores · Por definir y autorizar

1. Completar agentes IA: asistencia con datos reales según tratamiento contratado, automatización y escalamiento.
2. Ampliar automatizaciones: condiciones, herramientas externas e integraciones.
3. Onboarding comercial de canales/Embedded Signup según requisitos de Meta.
4. Analíticas verificables, CRM comercial, suscripciones y facturación.

No son fechas de entrega ni funciones disponibles. No se inicia otra fase automáticamente.
