-- MONZO: ejecutar TODO en neondb antes de publicar variables dinamicas.
-- Solo agrega el catalogo e importa identificadores heredados. No cambia flujos, valores ni mensajes.
DO $monzo_phase_10$
BEGIN
 PERFORM pg_catalog.set_config('search_path','public',true);
 IF current_database()<>'neondb' THEN RAISE EXCEPTION 'MONZO: elegi la base neondb.'; END IF;
 IF to_regclass('public._prisma_migrations') IS NULL OR to_regclass('public."AutomationFlow"') IS NULL THEN RAISE EXCEPTION 'MONZO: falta el esquema previo.'; END IF;
 LOCK TABLE public._prisma_migrations IN EXCLUSIVE MODE;
 IF EXISTS (SELECT migration_name FROM public._prisma_migrations GROUP BY migration_name HAVING count(*)<>1) THEN RAISE EXCEPTION 'MONZO: historial duplicado.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name<>ALL(ARRAY['202610290001_foundation','202610290002_auth_tenants','202610290003_whatsapp_inbox','202610290004_event_dispatch','202610300001_whatsapp_media','202610300002_whatsapp_templates','202610300003_gemini_lab','202610300004_guided_flows','202610310001_dynamic_variables'])) THEN RAISE EXCEPTION 'MONZO: hay migraciones no previstas.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610290001_foundation' AND (checksum<>'63e19ab65a1822977618a1ca291a873a59e41954213523f700cffaeb9b4b2b13' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290001_foundation.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610290002_auth_tenants' AND (checksum<>'67f5c97d01f0dce37f5af81f2e5a6a4077c86d986fe59213f94b6b5350f99b8c' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290002_auth_tenants.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610290003_whatsapp_inbox' AND (checksum<>'3b922830d49c8401a5a3b41ce5e8825e89e73ea42ff42e22102cc405deac5e63' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290003_whatsapp_inbox.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610290004_event_dispatch' AND (checksum<>'3224c27b344561a90ad42b9ba1c698edc819c39a9af75ca8bc871fe38f96ed21' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610290004_event_dispatch.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610300001_whatsapp_media' AND (checksum<>'7f6aa7ec2616ce537e8853b8f28b37d9fd0f630bda7b1283e50adef473b091cd' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300001_whatsapp_media.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610300002_whatsapp_templates' AND (checksum<>'8a8fbe181ca94118ed0b74c5fa246516ee0eb13a9def6faef63a8e506f79f106' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300002_whatsapp_templates.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610300003_gemini_lab' AND (checksum<>'725b5f5a81ab322b9e8f92637756cb6129c8a0b484e929feec1f1f7a115de08d' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300003_gemini_lab.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610300004_guided_flows' AND (checksum<>'7140c4729614f1393b7bdd80f24c6095ad33257c1cb43c06997bcd6202cffb80' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610300004_guided_flows.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610310001_dynamic_variables' AND (checksum<>'75ee61cc6f534702e008f4cacff700b1046151bc7a2f1d4f27b90e6f9328fb74' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en 202610310001_dynamic_variables.'; END IF;
 IF (SELECT count(*) FROM public._prisma_migrations WHERE migration_name=ANY(ARRAY['202610290001_foundation','202610290002_auth_tenants','202610290003_whatsapp_inbox','202610290004_event_dispatch','202610300001_whatsapp_media','202610300002_whatsapp_templates','202610300003_gemini_lab','202610300004_guided_flows']))<>8 THEN RAISE EXCEPTION 'MONZO: se esperan ocho migraciones previas.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='202610310001_dynamic_variables') THEN

 IF (SELECT count(*) FROM information_schema.columns c JOIN (VALUES ('id','text','NO'),('tenantId','text','NO'),('name','text','NO'),('identifier','text','NO'),('type','text','NO'),('description','text','NO'),('scope','text','NO'),('currency','text','NO'),('defaultValue','text','YES'),('revision','integer','NO'),('createdAt','timestamp without time zone','NO'),('updatedAt','timestamp without time zone','NO')) e(col,kind,nullable) ON c.column_name=e.col AND c.data_type=e.kind AND c.is_nullable=e.nullable WHERE c.table_schema='public' AND c.table_name='AutomationVariable') <> 12 THEN RAISE EXCEPTION 'MONZO: esquema de variables incompatible.'; END IF;
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='AutomationVariable') <> 12 THEN RAISE EXCEPTION 'MONZO: columnas de variables inesperadas.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace='public'::regnamespace AND conrelid='public."AutomationVariable"'::regclass AND convalidated AND conname IN ('AutomationVariable_pkey','AutomationVariable_tenantId_fkey','AutomationVariable_identifier_check','AutomationVariable_type_check','AutomationVariable_scope_check')) <> 5 THEN RAISE EXCEPTION 'MONZO: faltan restricciones de variables.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname='public' AND indexname IN ('AutomationVariable_pkey','AutomationVariable_tenantId_identifier_key')) <> 2 THEN RAISE EXCEPTION 'MONZO: faltan indices de variables.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='AutomationVariable' AND column_name='scope') IS DISTINCT FROM '''execution''::text' THEN RAISE EXCEPTION 'MONZO: alcance inicial incompatible.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='AutomationVariable' AND column_name='revision') IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'MONZO: revision inicial incompatible.'; END IF;

 RAISE NOTICE 'MONZO: variables ya aplicadas; datos conservados.'; RETURN;
 END IF;
 IF to_regclass('public."AutomationVariable"') IS NOT NULL THEN RAISE EXCEPTION 'MONZO: hay esquema sin historial de variables.'; END IF;
CREATE TABLE "AutomationVariable" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "name" TEXT NOT NULL,
 "identifier" TEXT NOT NULL, "type" TEXT NOT NULL, "description" TEXT NOT NULL DEFAULT '',
 "defaultValue" TEXT, "scope" TEXT NOT NULL DEFAULT 'execution', "currency" TEXT NOT NULL DEFAULT 'ARS',
 "revision" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "AutomationVariable_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "AutomationVariable_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "AutomationVariable_identifier_check" CHECK ("identifier" ~ '^[a-z][a-z0-9_]{0,39}$' AND "identifier" NOT IN ('constructor','prototype','__proto__')),
 CONSTRAINT "AutomationVariable_type_check" CHECK ("type" IN ('text','integer','decimal','currency','boolean','date','datetime','url')),
 CONSTRAINT "AutomationVariable_scope_check" CHECK ("scope" = 'execution')
);
CREATE UNIQUE INDEX "AutomationVariable_tenantId_identifier_key" ON "AutomationVariable"("tenantId","identifier");
-- Register valid legacy capture identifiers without changing published graphs or conversation values.
INSERT INTO "AutomationVariable" ("id","tenantId","name","identifier","type","description","updatedAt")
SELECT 'legacy_' || md5("tenantId" || ':' || identifier), "tenantId", identifier, identifier, 'text', 'Variable de un flujo anterior', CURRENT_TIMESTAMP
FROM (
 SELECT DISTINCT f."tenantId", n->>'variable' AS identifier FROM "AutomationFlow" f
 CROSS JOIN LATERAL (VALUES(f.draft),(f.published)) g(graph)
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(g.graph->'nodes')='array' THEN g.graph->'nodes' ELSE '[]'::jsonb END) n
 WHERE n->>'kind'='capture' AND n->>'variable' ~ '^[a-z][a-z0-9_]{0,39}$' AND n->>'variable' NOT IN ('constructor','prototype','__proto__')
) legacy;


 IF (SELECT count(*) FROM information_schema.columns c JOIN (VALUES ('id','text','NO'),('tenantId','text','NO'),('name','text','NO'),('identifier','text','NO'),('type','text','NO'),('description','text','NO'),('scope','text','NO'),('currency','text','NO'),('defaultValue','text','YES'),('revision','integer','NO'),('createdAt','timestamp without time zone','NO'),('updatedAt','timestamp without time zone','NO')) e(col,kind,nullable) ON c.column_name=e.col AND c.data_type=e.kind AND c.is_nullable=e.nullable WHERE c.table_schema='public' AND c.table_name='AutomationVariable') <> 12 THEN RAISE EXCEPTION 'MONZO: esquema de variables incompatible.'; END IF;
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='AutomationVariable') <> 12 THEN RAISE EXCEPTION 'MONZO: columnas de variables inesperadas.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace='public'::regnamespace AND conrelid='public."AutomationVariable"'::regclass AND convalidated AND conname IN ('AutomationVariable_pkey','AutomationVariable_tenantId_fkey','AutomationVariable_identifier_check','AutomationVariable_type_check','AutomationVariable_scope_check')) <> 5 THEN RAISE EXCEPTION 'MONZO: faltan restricciones de variables.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname='public' AND indexname IN ('AutomationVariable_pkey','AutomationVariable_tenantId_identifier_key')) <> 2 THEN RAISE EXCEPTION 'MONZO: faltan indices de variables.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='AutomationVariable' AND column_name='scope') IS DISTINCT FROM '''execution''::text' THEN RAISE EXCEPTION 'MONZO: alcance inicial incompatible.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='AutomationVariable' AND column_name='revision') IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'MONZO: revision inicial incompatible.'; END IF;

 INSERT INTO public._prisma_migrations (id,checksum,finished_at,migration_name,applied_steps_count) VALUES (md5(random()::text||clock_timestamp()::text),'75ee61cc6f534702e008f4cacff700b1046151bc7a2f1d4f27b90e6f9328fb74',now(),'202610310001_dynamic_variables',1);
 RAISE NOTICE 'MONZO: variables aplicadas; historial y conversaciones conservados.';
END
$monzo_phase_10$;

SELECT current_database() AS base,
 (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='AutomationVariable') AS tabla_variables,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='AutomationVariable') AS columnas_variables,
 (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migraciones_aplicadas;
