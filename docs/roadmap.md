# Roadmap

## Fase 1 · Fundación — publicada

Landing Cloud, demo, branding oficial, tokens, herramientas de calidad y esquema inicial. El logo y la mascota se preservan sin redibujar ni recolorear.

## Fase 2 · Autenticación y multiempresa — publicada

Cuentas con correo verificado, sesiones persistentes, recuperación, empresas y preferencias independientes, roles e invitaciones. La demo pública se mueve a `/demo` y `/dashboard` pasa a ser privado. La capa de acceso se comprueba con sesiones reales, PostgreSQL, correo local y pruebas cruzadas. Ver `docs/phase-2.md` y `docs/progress.md`.

Publicada desde main tras configurar Neon, Resend y secretos en Vercel. El usuario confirmó el correo externo, la cuenta verificada y la creación de una empresa con acceso al dashboard. La cobertura local y los límites de verificación en producción están registrados en docs/progress.md.

## Fase 3 · WhatsApp y atención humana — validación local

Cloud API oficial, webhook firmado, recepción idempotente, worker Redis/BullMQ, contactos, bandeja, respuestas de texto, estados y colaboración humana. Implementada en `feat/phase-3-whatsapp-inbox`; sin despliegue ni conexión real a Meta. El usuario parte de una cuenta de WhatsApp Business, sin app de desarrollador: comenzar con el número de prueba. El usuario ya creó la app, recibió la prueba de la consola Meta y guardó las tres variables de Meta/cifrado en Vercel. Solicitó alojamiento gratuito: se preparó el modo Vercel + QStash, sujeto a confirmar el plan Free y sus cuotas. Falta configurar QStash, migrar/publicar y probar el flujo bidireccional con MONZO. Ver `docs/phase-3.md`.

## Fases posteriores · Por definir y autorizar

1. Plantillas, medios y onboarding comercial de canales según requisitos de Meta.
2. Agentes IA, conocimientos, presupuestos de consumo y escalamiento.
3. Automatizaciones y herramientas externas sobre el worker.
4. Analíticas verificables, CRM comercial, suscripciones y facturación.

No son fechas de entrega ni funciones disponibles. No se inicia otra fase automáticamente.
