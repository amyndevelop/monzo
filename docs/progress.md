# Progreso · Fase 1

Fecha: 29 de octubre de 2026.

## Estado

Fase 1 completada en el checkout local. El logo original ya está integrado desde el PDF vectorial recibido; Prisma CLI y todas las comprobaciones de la fase pasaron en esta instancia. No se avanzó a Fase 2 y no hubo despliegue de producción ni push a GitHub.

El repositorio inicial estaba vacío, sin commits. Se verificó acceso GitHub por el proxy y ausencia de la referencia remota `main`. El código nuevo queda en el checkout `/workspace/monzo`, sin eliminar información previa. El usuario publicó el entorno y esta instancia recuperó los archivos del proyecto. No hubo push a GitHub ni publicación adicional por parte del agente.

## Implementado

- Next.js App Router, TypeScript estricto, Tailwind 4, shadcn/ui y Lucide.
- ESLint, Prettier, lockfile npm, Node fijado y scripts de desarrollo/build/verificación.
- Sistema visual Cloud con Inter local, tokens, estados de foco y movimiento reducido.
- Landing con header, hero, beneficios, funcionamiento previsto, capacidades futuras, cierre y footer.
- Dashboard público con inicio y siete rutas de próximas funcionalidades, sidebar responsive y selector informativo de empresa.
- Avisos explícitos de demo sin sesión, datos reales ni métricas inventadas.
- Logo oficial vectorial integrado en header, footer y sidebar, sin redibujar ni recolorear; PDF original conservado con hash SHA-256 idéntico al recibido.
- Componente Mascot con 20 reacciones extraídas, transparencias preservadas y PDF original organizado.
- Favicon basado en la mascota original, metadatos, 404 y cabeceras básicas.
- Esquema PostgreSQL con User, Tenant, Membership y TenantSettings; helper Prisma solo servidor, diferido y sin consultas en páginas públicas.
- Límite operativo de denegación por defecto. No constituye autenticación ni aislamiento completo.
- README, arquitectura, branding, roadmap, progreso y `.env.example`.

## Evidencia de validación

| Comprobación                  | Resultado                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm install`                 | Dependencias instaladas con lockfile                                                               |
| `npm run typecheck`           | Aprobado                                                                                           |
| `npm run format:check`        | Aprobado                                                                                           |
| `npm run dev`                 | Iniciado; HTTP 200 y contenido esperado verificados en `/`, `/dashboard` y `/dashboard/agentes-ia` |
| `npm run lint`                | Aprobado sin advertencias de lint                                                                  |
| `npm run build`               | Aprobado; landing, demo y siete secciones prerenderizadas                                          |
| `npm test`                    | 10/10 aprobados: cinco casos en escritorio y móvil                                                 |
| Logo oficial                  | SVG cargado y visible en escritorio y móvil; proporciones conservadas sobre superficie petróleo    |
| Revisión visual               | Capturas de landing, dashboard y sección próxima; escritorio 1440 px y móvil 390 px                |
| Imágenes/anclas               | Recursos cargan, ancla a funcionalidades y CTA a demo funcionan                                    |
| Navegación                    | Selector explicativo, siete secciones, aria-current y menús responsive verificados                 |
| Seguridad básica              | Operaciones denegadas, avisos de demo, 404, favicon y cabeceras verificados                        |
| Overflow                      | Sin desborde horizontal en páginas recorridas en ambas resoluciones                                |
| `npm run db:generate`         | Aprobado en la instancia restaurada: Prisma Client 6.19.3 generado                                 |
| `npm run db:validate`         | Aprobado en la instancia restaurada: esquema válido                                                |
| Migración/conexión PostgreSQL | No ejecutadas; no necesarias para las páginas públicas de Fase 1                                   |

Next.js generó su archivo `AGENTS.md` al iniciar desarrollo; se conservó. El servidor de desarrollo se inició y comprobó en la instancia anterior; no se presupone activo después de restaurar el entorno.

El primer build falló por una restricción de puertos del sandbox; pasó al ejecutarlo con permiso para puertos locales, sin cambios de lógica. Las primeras ejecuciones de pruebas detectaron selectores que omitían “Próximamente”, el cambio de nombre accesible del botón abierto y la carga diferida de imágenes. Se corrigieron las pruebas para esperar el comportamiento real, sin desactivar aserciones. La suite posterior pasó completa.

Playwright usa Chromium preinstalado (`/usr/bin/chromium`): la descarga opcional de su navegador empaquetado fue bloqueada por política de red, pero no impidió las pruebas. No se deshabilitó TLS ni verificación de checksums de Prisma.

## Recursos y límites de configuración

1. **Logo resuelto**: el PDF vectorial recibido se conserva en `assets/brand/originals/monzo-logo.pdf` y se exportó directamente con `pdftocairo -svg` a `public/brand/logo/monzo-light.svg`. Se reemplazó el identificador textual provisional sin cambiar formas, colores ni proporciones. No hace falta un PNG adicional.
2. **Prisma resuelto**: la política de la instancia restaurada permite `binaries.prisma.sh`. Se ejecutaron correctamente `npm run db:generate`, `npm run db:validate` y `npm run typecheck`. No se ejecutaron migraciones ni se probó una conexión PostgreSQL.
3. **Entorno reutilizable**: el usuario informó la publicación y se observaron los archivos restaurados en la nueva instancia. No se reaplicaron los cambios previos ni se modificó o publicó el nuevo borrador. Después de integrar el logo se ejecutaron nuevamente validación de Prisma, TypeScript, lint, formato, build y las 10 pruebas de navegador; todas pasaron. Se revisaron las capturas actualizadas de escritorio y móvil. El servidor de producción de las pruebas se detuvo al terminar la suite.
4. **Resolución de mascota**: los originales son pequeños (aproximadamente 255–348 px de ancho). Se mantuvieron sin reconstrucción artificial; ver branding.

## Siguiente paso

La Fase 1 queda cerrada en código y documentación. Los cambios del logo no se han publicado. La siguiente fase de desarrollo será **Fase 2: autenticación y multiempresa**, solo con una nueva instrucción. Redis/BullMQ, Meta, OpenAI, CRM operativo, pagos y analíticas reales siguen fuera del alcance actual.
