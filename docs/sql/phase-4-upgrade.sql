-- MONZO Fase 4: base neondb; ejecutar TODO el archivo.
-- Una sola transaccion DO: conserva mensajes, cuentas y empresas. No repetir Fase 2 o 3.
-- Generado desde las migraciones versionadas; no editar los checksums.
DO $monzo_phase_4$
BEGIN
 PERFORM pg_catalog.set_config('search_path', 'public', true);
 IF current_database() <> 'neondb' THEN RAISE EXCEPTION 'MONZO: elegi la base neondb.'; END IF;
 IF to_regclass('public._prisma_migrations') IS NULL OR to_regclass('public."Message"') IS NULL THEN RAISE EXCEPTION 'MONZO: falta el esquema de Fase 3.'; END IF;
 LOCK TABLE public._prisma_migrations IN EXCLUSIVE MODE;
 IF EXISTS (SELECT migration_name FROM public._prisma_migrations GROUP BY migration_name HAVING count(*) <> 1) THEN RAISE EXCEPTION 'MONZO: historial duplicado.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name <> ALL (ARRAY['202610290001_foundation', '202610290002_auth_tenants', '202610290003_whatsapp_inbox', '202610290004_event_dispatch', '202610300001_whatsapp_media'])) THEN RAISE EXCEPTION 'MONZO: hay migraciones no previstas.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '202610290001_foundation' AND (checksum <> '63e19ab65a1822977618a1ca291a873a59e41954213523f700cffaeb9b4b2b13' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290001_foundation.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '202610290002_auth_tenants' AND (checksum <> '67f5c97d01f0dce37f5af81f2e5a6a4077c86d986fe59213f94b6b5350f99b8c' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290002_auth_tenants.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '202610290003_whatsapp_inbox' AND (checksum <> '3b922830d49c8401a5a3b41ce5e8825e89e73ea42ff42e22102cc405deac5e63' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290003_whatsapp_inbox.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '202610290004_event_dispatch' AND (checksum <> '3224c27b344561a90ad42b9ba1c698edc819c39a9af75ca8bc871fe38f96ed21' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290004_event_dispatch.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '202610300001_whatsapp_media' AND (checksum <> '7f6aa7ec2616ce537e8853b8f28b37d9fd0f630bda7b1283e50adef473b091cd' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300001_whatsapp_media.'; END IF;
 IF (SELECT count(*) FROM public._prisma_migrations WHERE migration_name = ANY (ARRAY['202610290001_foundation', '202610290002_auth_tenants', '202610290003_whatsapp_inbox', '202610290004_event_dispatch'])) <> 4 THEN RAISE EXCEPTION 'MONZO: se esperan cuatro migraciones previas.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '202610300001_whatsapp_media') THEN
  IF (SELECT count(*) FROM information_schema.columns c JOIN (VALUES ('mediaMimeType','text'), ('mediaFilename','text'), ('mediaSize','integer'), ('mediaSha256','text')) AS expected(name, kind) ON c.column_name = expected.name AND c.data_type = expected.kind WHERE c.table_schema='public' AND c.table_name='Message' AND c.is_nullable='YES') <> 4 THEN RAISE EXCEPTION 'MONZO: historial aplicado pero faltan columnas o su tipo no coincide.'; END IF;
  RAISE NOTICE 'MONZO: Fase 4 ya estaba aplicada. No se modificaron datos.';
  RETURN;
 END IF;
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Message' AND column_name IN ('mediaMimeType','mediaFilename','mediaSize','mediaSha256')) THEN RAISE EXCEPTION 'MONZO: hay columnas sin historial de Fase 4. Revisar antes de continuar.'; END IF;
-- Add nullable metadata; preserve existing messages and all previous migrations.
ALTER TABLE "Message"
  ADD COLUMN "mediaMimeType" TEXT,
  ADD COLUMN "mediaFilename" TEXT,
  ADD COLUMN "mediaSize" INTEGER,
  ADD COLUMN "mediaSha256" TEXT;

 INSERT INTO public._prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ('7f6aa7ec-2616-4e53-ae88-53b8f28b37d9', '7f6aa7ec2616ce537e8853b8f28b37d9fd0f630bda7b1283e50adef473b091cd', now(), '202610300001_whatsapp_media', 1);
 RAISE NOTICE 'MONZO: Fase 4 aplicada. Datos existentes conservados.';
END
$monzo_phase_4$;

SELECT current_database() AS base,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Message' AND column_name IN ('mediaMimeType','mediaFilename','mediaSize','mediaSha256')) AS columnas_adjuntos,
 (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migraciones_aplicadas;
