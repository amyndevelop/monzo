# Roadmap

## Fase 1 · Fundación — publicada

Landing Cloud, demo, branding oficial, tokens, herramientas de calidad y esquema inicial. El logo y la mascota se preservan sin redibujar ni recolorear.

## Fase 2 · Autenticación y multiempresa — desarrollo local

Cuentas con correo verificado, sesiones persistentes, recuperación, empresas y preferencias independientes, roles e invitaciones. La demo pública se mueve a `/demo` y `/dashboard` pasa a ser privado. La capa de acceso se comprueba con sesiones reales, PostgreSQL, correo local y pruebas cruzadas. Ver `docs/phase-2.md` y `docs/progress.md`.

Publicar esta fase requiere PostgreSQL gestionado, SMTP con remitente verificado y secretos propios del entorno de Vercel. No se desplegará ni enviará a main sin instrucción explícita.

## Fases posteriores · Por definir y autorizar

1. Meta Cloud API oficial, validación de webhooks, idempotencia y estados de mensajes.
2. Conversaciones, contactos y colaboración humana operativa.
3. Agentes IA, conocimientos, presupuestos de consumo y escalamiento.
4. Worker Redis/BullMQ, automatizaciones y herramientas externas.
5. Analíticas verificables, CRM comercial, suscripciones y facturación.

No son fechas de entrega ni funciones disponibles. No se inicia otra fase automáticamente.
