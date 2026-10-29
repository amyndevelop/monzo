# Fase 2 · Autenticación y multiempresa

## Alcance implementado

Registro personal por correo y contraseña, verificación obligatoria, reenvío de verificación, login/logout y recuperación. Crear y seleccionar empresas, mantener preferencias por empresa, invitar equipo por correo y administrar membresías con roles OWNER/ADMIN/MEMBER. La demo se conserva en `/demo`; `/dashboard` usa acceso real.

Better Auth se eligió en lugar de implementar criptografía de sesiones propia o depender de un proveedor externo de identidad con credenciales todavía no disponibles. Su adaptador Prisma soporta transacciones, sesiones verificadas en la base y protección de enumeración. SMTP desacopla el envío del proveedor comercial que se elija para producción.

## Preparación probada

Seguir README: `npm ci`, `setup:local`, `services:up`, `db:generate` y `db:migrate`. Las imágenes de PostgreSQL y Mailpit están fijadas por digest. La base de pruebas y la de desarrollo son instancias y volúmenes distintos. El runner valida el destino antes de aplicar migraciones a pruebas; no usa resets.

No se necesitan OpenAI, Meta o Redis. No hay servicios externos simulados como activos: Mailpit está identificado como buzón de desarrollo y la interfaz no muestra métricas de negocios de prueba en la demo.

## Validación

Las pruebas de navegador recorren registro, correo de verificación capturado en SMTP, login, creación de empresa, preferencias, equipo y logout en escritorio y móvil. Las pruebas por HTTP usan sesiones reales y PostgreSQL para comprobar cookies inventadas, correo no verificado, contraseñas erróneas, IDs de otra empresa, escalamiento de rol, invitaciones ajenas/vencidas/reutilizadas, acceso revocado, protección del último propietario bajo concurrencia, recuperación de contraseña, revocación de sesiones y límites de intentos.

El resumen de resultados queda en `docs/progress.md`. Los logs de contraseñas incorrectas y origen rechazado son resultados negativos esperados; no deben confundirse con fallos de infraestructura.

## Publicación y comprobación en producción

Se preparó Neon monzo-db y el usuario confirmó las 10 tablas y 2 migraciones. Resend muestra el dominio remitente verificado y el usuario confirmó haber guardado la configuración de producción en Vercel. Las variables requeridas son `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`, `SMTP_USER` y `SMTP_PASSWORD`, sin escribir secretos en el repositorio o el chat.

La URL de autenticación debe coincidir exactamente con el dominio HTTPS publicado; no usar comodines de confianza para dominios Preview. Usar otra base y otro secreto para Preview. No migrar una base compartida o de producción automáticamente durante un build. Primero revisar/aplicar las migraciones en el entorno correspondiente y después desplegar el código autorizado.

Sin configuración válida, las pantallas de cuenta indican que el acceso está en preparación y las APIs no admiten una sesión falsa. La aplicación del esquema de producción fue confirmada por el usuario mediante la consulta de tablas y migraciones. Tras el push `1021164`, el usuario confirmó entrega externa de correo, verificación, ingreso HTTPS, creación de empresa y acceso al dashboard mediante capturas. La comprobación de flags de cookies, recuperación, invitaciones y aislamiento entre cuentas en producción sigue pendiente; esos controles pasaron localmente.

## Fuera de alcance

MFA, login social, passkeys, RLS, eliminación de empresas/usuarios, facturación, canales, conversaciones, agentes IA y automatizaciones. No se inició Fase 3. El push a main inicia el despliegue automático, cuyo resultado debe comprobarse por separado.

## Inicialización manual de la base nueva de Neon

`docs/sql/phase-2-bootstrap.sql` reúne exactamente las dos migraciones dentro de una única sentencia DO atómica, y registra su historial Prisma con los checksums originales. Está destinado únicamente a la base nueva de MONZO, no a una base existente. Rechaza la ejecución si encuentra tablas en el esquema public; no borra datos. Se probó en una base local vacía: Prisma confirmó el historial actualizado y ausencia de diferencias de esquema; una segunda ejecución se rechazó antes de cambiar tablas. La ejecución en Neon requiere seleccionar y comprobar el proyecto y la base correctos en su editor SQL. No se ejecutó automáticamente sobre producción.
