# Roadmap

## Fase 1 · Fundación — publicada

Landing Cloud, demo, branding oficial, tokens, herramientas de calidad y esquema inicial. El logo y la mascota se preservan sin redibujar ni recolorear.

## Fase 2 · Autenticación y multiempresa — publicada

Cuentas con correo verificado, sesiones persistentes, recuperación, empresas y preferencias independientes, roles e invitaciones. La demo pública se mueve a `/demo` y `/dashboard` pasa a ser privado. La capa de acceso se comprueba con sesiones reales, PostgreSQL, correo local y pruebas cruzadas. Ver `docs/phase-2.md` y `docs/progress.md`.

Publicada desde main tras configurar Neon, Resend y secretos en Vercel. El usuario confirmó el correo externo, la cuenta verificada y la creación de una empresa con acceso al dashboard. La cobertura local y los límites de verificación en producción están registrados en docs/progress.md.

## Fase 3 · WhatsApp y atención humana — publicada

Cloud API oficial, webhook firmado, recepción idempotente, contactos, bandeja, respuestas de texto, estados y colaboración humana. Publicada en Vercel con QStash por eventos, sin worker permanente ni Redis remoto. El usuario confirmó recepción y envío reales con el número de prueba, corrigió el destinatario argentino y sustituyó el token temporal por uno de usuario del sistema. El número comercial permanece sin migrar. Ver `docs/phase-3.md`.

## Fase 4 · Adjuntos — código integrado; validación de producción pendiente

El usuario autorizó continuar el desarrollo de la siguiente fase tras revisar su alcance. Se implementaron imágenes, audio, video y documentos, con apertura/descarga privada y envío por la cola actual. Usa almacenamiento de Meta y un límite de 3 MiB por archivo, sin servicios adicionales. El usuario confirmó la migración de Neon con neondb | 4 | 5. Código integrado en main para publicación; pendientes Ready y prueba de adjuntos en producción. Ver `docs/phase-4.md`.

## Fases posteriores · Por definir y autorizar

1. Plantillas y onboarding comercial de canales según requisitos de Meta.
2. Agentes IA, conocimientos, presupuestos de consumo y escalamiento.
3. Automatizaciones y herramientas externas sobre el worker.
4. Analíticas verificables, CRM comercial, suscripciones y facturación.

No son fechas de entrega ni funciones disponibles. No se inicia otra fase automáticamente.
