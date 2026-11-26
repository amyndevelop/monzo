-- Solo lectura. En Neon seleccionar antes la rama monzo-evolution-test y neondb.
-- Una copia "Branch schema only" debe conservar tablas, pero no filas de aplicación.
-- No inicializa ni modifica el historial de Prisma.
BEGIN READ ONLY;
SELECT
  current_database() AS base,
  current_schema() AS esquema,
  (SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public') AS tablas_publicas,
  (SELECT count(*) FROM public."User") AS usuarios,
  (SELECT count(*) FROM public."Tenant") AS empresas,
  (SELECT count(*) FROM public."WhatsappAccount") AS canales,
  (SELECT count(*) FROM public."Contact") AS contactos,
  (SELECT count(*) FROM public."Conversation") AS conversaciones,
  (SELECT count(*) FROM public."Message") AS mensajes,
  (SELECT count(*) FROM public._prisma_migrations) AS migraciones_registradas;
COMMIT;
