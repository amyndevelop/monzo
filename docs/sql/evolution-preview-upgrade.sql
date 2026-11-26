-- MONZO Evolution: SOLO monzo-evolution-test / neondb. Ejecutar TODO el archivo.
-- Requiere la marca del baseline de pruebas; rechaza el historial original de produccion.
-- Atomico y repetible. Conserva usuarios, empresas, mensajes y configuraciones anteriores.
DO $monzo_evolution_preview_upgrade$
DECLARE actual_fingerprint jsonb; expected_fingerprint jsonb; different_sections text; table_row record; applied boolean;
BEGIN
 PERFORM pg_catalog.set_config('search_path','public,pg_catalog',true);
 PERFORM pg_catalog.set_config('lock_timeout','5s',true);
 IF current_database()<>'neondb' OR to_regclass('public._prisma_migrations') IS NULL THEN RAISE EXCEPTION 'MONZO: selecciona la base de pruebas preparada.'; END IF;
 FOR table_row IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname COLLATE "C" LOOP
  EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',table_row.relname);
 END LOOP;
 IF EXISTS(SELECT migration_name FROM _prisma_migrations GROUP BY migration_name HAVING count(*)<>1) OR
 EXISTS(SELECT 1 FROM _prisma_migrations h LEFT JOIN (VALUES ('202610290001_foundation','63e19ab65a1822977618a1ca291a873a59e41954213523f700cffaeb9b4b2b13'),
 ('202610290002_auth_tenants','67f5c97d01f0dce37f5af81f2e5a6a4077c86d986fe59213f94b6b5350f99b8c'),
 ('202610290003_whatsapp_inbox','3b922830d49c8401a5a3b41ce5e8825e89e73ea42ff42e22102cc405deac5e63'),
 ('202610290004_event_dispatch','3224c27b344561a90ad42b9ba1c698edc819c39a9af75ca8bc871fe38f96ed21'),
 ('202610300001_whatsapp_media','7f6aa7ec2616ce537e8853b8f28b37d9fd0f630bda7b1283e50adef473b091cd'),
 ('202610300002_whatsapp_templates','8a8fbe181ca94118ed0b74c5fa246516ee0eb13a9def6faef63a8e506f79f106'),
 ('202610300003_gemini_lab','725b5f5a81ab322b9e8f92637756cb6129c8a0b484e929feec1f1f7a115de08d'),
 ('202610300004_guided_flows','7140c4729614f1393b7bdd80f24c6095ad33257c1cb43c06997bcd6202cffb80'),
 ('202610310001_dynamic_variables','75ee61cc6f534702e008f4cacff700b1046151bc7a2f1d4f27b90e6f9328fb74'),
 ('202611020001_contact_follow_up','de5778ca9ca13bd04c5f6b08ab06e4466c6f49d87e1be3420ff2c85e7feb7cc2'),
 ('202611050001_whatsapp_qr','7489f7a231bcf9ecf9fd27dceeba9a65e5767d18d388a48810ccd3e009d3de6b'),
 ('202611260001_evolution_channels','a492fc4b0bd3ff3a739917e23987b4364beb682e83901e2b85c82f4eccb6c333')) AS e(name,checksum) ON h.migration_name=e.name
 WHERE e.name IS NULL OR h.checksum<>e.checksum OR h.finished_at IS NULL OR h.rolled_back_at IS NOT NULL) OR
 (SELECT count(*) FROM _prisma_migrations WHERE migration_name<>'202611260001_evolution_channels')<>11 THEN
  RAISE EXCEPTION 'MONZO: historial previo incompatible. No se modifico nada.';
 END IF;
 IF EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name<>'202611260001_evolution_channels' AND id<>md5('monzo-preview-baseline:'||migration_name)) THEN
  RAISE EXCEPTION 'MONZO: falta la marca del baseline de pruebas. No ejecutar en produccion.';
 END IF;
 SELECT EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name='202611260001_evolution_channels') INTO applied;
 expected_fingerprint=CASE WHEN applied THEN '{"enums":"fefa215d47afda7245ef50774564a7f02ba72efc96988726cb6d608d0cf0cbe0","columns":"34bdac3149103578aa7b304412e3ae77c79f52c14d402d5e6b4617a12661f9b6","indexes":"8b4c4885dde5ff04a79e982732e22e84329ee1a6db5e92c253e2087a62dc2a8d","relations":"14e1a7f4c6986d58319f58cdc99225ba731d5d14bf9995db111c4dde27b60326","constraints":"26f50567a74b5cb6744d2cc1b52944c9b4a996d6284153fcf7a8ffbb71d0e34a"}'::jsonb ELSE '{"enums":"fefa215d47afda7245ef50774564a7f02ba72efc96988726cb6d608d0cf0cbe0","columns":"7056bf95633ec2c7eac9925bdc032a2e0370ea4c7562b08d6af4c95a6f4fdc0a","indexes":"8d9923204300fbccb9aac976a8169464a57e38e8eec5284e83c10703377157dc","relations":"47143f202230097f72329d2580e3d8a56e244a266d847a0f3639190985196cf0","constraints":"c4d69c411b3b903aff18f9ae3c7d467e66ba599a0ab1c452d24d57236e19e214"}'::jsonb END;
 IF EXISTS (
  SELECT 1 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.conkey[1]
  WHERE n.nspname='public' AND k.contype='n' AND (
   NOT k.convalidated OR k.condeferrable OR k.condeferred OR
   to_jsonb(k)->>'conenforced' IS DISTINCT FROM 'true' OR
   cardinality(k.conkey) IS DISTINCT FROM 1 OR NOT COALESCE(a.attnotnull,false)
  )
 ) THEN RAISE EXCEPTION 'MONZO: restricciones NOT NULL sin validar o incompatibles. No se registro historial.'; END IF;
 WITH items AS (
 SELECT 'relations' AS kind, jsonb_build_array(c.relname,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity) AS item
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')
 UNION ALL
 SELECT 'columns',jsonb_build_array(c.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),co.collname)
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum LEFT JOIN pg_collation co ON co.oid=a.attcollation
 WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL
 SELECT 'constraints',jsonb_build_array(c.relname,k.conname,k.contype,k.convalidated,k.condeferrable,k.condeferred,pg_get_constraintdef(k.oid,false))
 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND k.contype<>'n'
 UNION ALL
 SELECT 'indexes',jsonb_build_array(c.relname,i.relname,x.indisunique,x.indisprimary,x.indisvalid,x.indisready,x.indnullsnotdistinct,pg_get_indexdef(x.indexrelid))
 FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
 UNION ALL
 SELECT 'enums',jsonb_build_array(t.typname,e.enumlabel,e.enumsortorder)
 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'
 UNION ALL
 SELECT 'triggers',jsonb_build_array(c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,false))
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
 UNION ALL
 SELECT 'policies',jsonb_build_array(c.relname,p.polname,p.polcmd,p.polpermissive,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))
 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
), fingerprints AS (
 SELECT kind,encode(sha256(convert_to(string_agg(item::text,E'\n' ORDER BY item::text COLLATE "C"),'UTF8')),'hex') AS digest FROM items GROUP BY kind
)
SELECT jsonb_object_agg(kind,digest) INTO actual_fingerprint FROM fingerprints;
 IF actual_fingerprint IS DISTINCT FROM expected_fingerprint THEN
  SELECT string_agg(key,', ' ORDER BY key) INTO different_sections FROM jsonb_object_keys(COALESCE(actual_fingerprint,'{}'::jsonb)||expected_fingerprint) AS k(key) WHERE actual_fingerprint->key IS DISTINCT FROM expected_fingerprint->key;
  RAISE EXCEPTION 'MONZO: estructura incompatible (%). No se modifico nada.',different_sections;
 END IF;
 IF NOT applied THEN
ALTER TABLE "WhatsappAccount" DROP CONSTRAINT "WhatsappAccount_provider_check";
ALTER TABLE "WhatsappAccount" ADD CONSTRAINT "WhatsappAccount_provider_check" CHECK ("provider" IN ('META','BAILEYS','EVOLUTION'));
ALTER TABLE "Message" ADD COLUMN "channelGeneration" INTEGER;
ALTER TABLE "Message" ADD CONSTRAINT "Message_channelGeneration_check" CHECK ("channelGeneration" IS NULL OR "channelGeneration">0);

CREATE TABLE "EvolutionSession" (
 "accountId" TEXT NOT NULL PRIMARY KEY,
 "tenantId" TEXT NOT NULL,
 "expectedWaId" TEXT NOT NULL,
 "connectedWaId" TEXT,
 "generation" INTEGER NOT NULL DEFAULT 1,
 "desiredState" TEXT NOT NULL DEFAULT 'DISCONNECTED',
 "state" TEXT NOT NULL DEFAULT 'DISCONNECTED',
 "qrEncrypted" TEXT,
 "qrExpiresAt" TIMESTAMP(3),
 "lastSeenAt" TIMESTAMP(3),
 "lastEventSequence" BIGINT NOT NULL DEFAULT 0,
 "lastErrorCode" TEXT,
 "commandId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "EvolutionSession_accountId_tenantId_fkey" FOREIGN KEY ("accountId","tenantId") REFERENCES "WhatsappAccount"("id","tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "EvolutionSession_phone_check" CHECK ("expectedWaId" ~ '^[1-9][0-9]{5,14}$'),
 CONSTRAINT "EvolutionSession_identity_check" CHECK ("connectedWaId" IS NULL OR "connectedWaId"="expectedWaId"),
 CONSTRAINT "EvolutionSession_generation_check" CHECK ("generation">0 AND "lastEventSequence">=0),
 CONSTRAINT "EvolutionSession_desired_check" CHECK ("desiredState" IN ('CONNECTED','DISCONNECTED')),
 CONSTRAINT "EvolutionSession_state_check" CHECK ("state" IN ('DISCONNECTED','CONNECTING','QR','CONNECTED','DISCONNECTING','ERROR'))
);
CREATE UNIQUE INDEX "EvolutionSession_accountId_tenantId_key" ON "EvolutionSession"("accountId","tenantId");
CREATE UNIQUE INDEX "EvolutionSession_tenantId_expectedWaId_key" ON "EvolutionSession"("tenantId","expectedWaId");
CREATE INDEX "EvolutionSession_tenantId_idx" ON "EvolutionSession"("tenantId");
CREATE UNIQUE INDEX "EvolutionSession_active_phone_key" ON "EvolutionSession"("expectedWaId") WHERE "desiredState"='CONNECTED';

CREATE TABLE "EvolutionDelivery" (
 "id" VARCHAR(64) NOT NULL PRIMARY KEY,
 "tenantId" TEXT NOT NULL,
 "accountId" TEXT NOT NULL,
 "generation" INTEGER NOT NULL,
 "sequence" BIGINT NOT NULL,
 "digest" VARCHAR(64) NOT NULL,
 "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "EvolutionDelivery_accountId_tenantId_fkey" FOREIGN KEY ("accountId","tenantId") REFERENCES "WhatsappAccount"("id","tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "EvolutionDelivery_identity_check" CHECK ("id" ~ '^[a-f0-9]{64}$' AND "digest" ~ '^[a-f0-9]{64}$'),
 CONSTRAINT "EvolutionDelivery_generation_check" CHECK ("generation">0 AND "sequence">0)
);
CREATE INDEX "EvolutionDelivery_accountId_processedAt_idx" ON "EvolutionDelivery"("accountId","processedAt");
CREATE INDEX "EvolutionDelivery_processedAt_idx" ON "EvolutionDelivery"("processedAt");

 INSERT INTO public._prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count)
 VALUES(md5('monzo-preview-evolution:202611260001_evolution_channels'),'a492fc4b0bd3ff3a739917e23987b4364beb682e83901e2b85c82f4eccb6c333',now(),'202611260001_evolution_channels',1);
 END IF;
 RAISE NOTICE 'MONZO: esquema Evolution preparado; esto no conecta un telefono ni activa el servicio.';
END
$monzo_evolution_preview_upgrade$;
SELECT current_database() AS base,
 (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migraciones_registradas,
 (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='EvolutionSession') AS tabla_conexion,
 (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='EvolutionDelivery') AS tabla_eventos,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Message' AND column_name='channelGeneration') AS columna_generacion,
 (SELECT count(*) FROM public."User") AS usuarios,
 (SELECT count(*) FROM public."Tenant") AS empresas;
