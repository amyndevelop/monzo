-- MONZO: SOLO en Neon / monzo-evolution-test / neondb, copia Branch schema only.
-- Registrar el historial existente: no recrea tablas ni agrega columnas.
-- Atomico: exige estructura exacta y todas las tablas de aplicacion vacias.
-- Una repeticion con el historial completo y correcto no escribe nada.
DO $monzo_preview_baseline$
DECLARE
 actual_fingerprint jsonb;
 different_sections text;
 table_row record;
 contains_rows boolean;
 history_count bigint;
BEGIN
 PERFORM pg_catalog.set_config('search_path','public,pg_catalog',true);
 PERFORM pg_catalog.set_config('lock_timeout','5s',true);
 IF current_database()<>'neondb' THEN RAISE EXCEPTION 'MONZO: selecciona neondb en la rama de pruebas.'; END IF;
 IF to_regclass('public._prisma_migrations') IS NULL THEN RAISE EXCEPTION 'MONZO: falta el esquema copiado. No se modifico nada.'; END IF;
 FOR table_row IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname COLLATE "C" LOOP
  EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',table_row.relname);
 END LOOP;
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
 IF actual_fingerprint IS DISTINCT FROM '{"enums":"fefa215d47afda7245ef50774564a7f02ba72efc96988726cb6d608d0cf0cbe0","columns":"7056bf95633ec2c7eac9925bdc032a2e0370ea4c7562b08d6af4c95a6f4fdc0a","indexes":"8d9923204300fbccb9aac976a8169464a57e38e8eec5284e83c10703377157dc","relations":"47143f202230097f72329d2580e3d8a56e244a266d847a0f3639190985196cf0","constraints":"c4d69c411b3b903aff18f9ae3c7d467e66ba599a0ab1c452d24d57236e19e214"}'::jsonb THEN
  SELECT string_agg(key,', ' ORDER BY key) INTO different_sections FROM jsonb_object_keys(COALESCE(actual_fingerprint,'{}'::jsonb)||'{"enums":"fefa215d47afda7245ef50774564a7f02ba72efc96988726cb6d608d0cf0cbe0","columns":"7056bf95633ec2c7eac9925bdc032a2e0370ea4c7562b08d6af4c95a6f4fdc0a","indexes":"8d9923204300fbccb9aac976a8169464a57e38e8eec5284e83c10703377157dc","relations":"47143f202230097f72329d2580e3d8a56e244a266d847a0f3639190985196cf0","constraints":"c4d69c411b3b903aff18f9ae3c7d467e66ba599a0ab1c452d24d57236e19e214"}'::jsonb) AS k(key)
  WHERE actual_fingerprint->key IS DISTINCT FROM '{"enums":"fefa215d47afda7245ef50774564a7f02ba72efc96988726cb6d608d0cf0cbe0","columns":"7056bf95633ec2c7eac9925bdc032a2e0370ea4c7562b08d6af4c95a6f4fdc0a","indexes":"8d9923204300fbccb9aac976a8169464a57e38e8eec5284e83c10703377157dc","relations":"47143f202230097f72329d2580e3d8a56e244a266d847a0f3639190985196cf0","constraints":"c4d69c411b3b903aff18f9ae3c7d467e66ba599a0ab1c452d24d57236e19e214"}'::jsonb->key;
  RAISE EXCEPTION 'MONZO: estructura incompatible (%). No se registro historial.',different_sections;
 END IF;
 SELECT count(*) INTO history_count FROM public._prisma_migrations;
 IF history_count>0 THEN
  IF history_count<>11 OR EXISTS (
   SELECT 1 FROM public._prisma_migrations h FULL JOIN (VALUES ('202610290001_foundation','63e19ab65a1822977618a1ca291a873a59e41954213523f700cffaeb9b4b2b13'),
 ('202610290002_auth_tenants','67f5c97d01f0dce37f5af81f2e5a6a4077c86d986fe59213f94b6b5350f99b8c'),
 ('202610290003_whatsapp_inbox','3b922830d49c8401a5a3b41ce5e8825e89e73ea42ff42e22102cc405deac5e63'),
 ('202610290004_event_dispatch','3224c27b344561a90ad42b9ba1c698edc819c39a9af75ca8bc871fe38f96ed21'),
 ('202610300001_whatsapp_media','7f6aa7ec2616ce537e8853b8f28b37d9fd0f630bda7b1283e50adef473b091cd'),
 ('202610300002_whatsapp_templates','8a8fbe181ca94118ed0b74c5fa246516ee0eb13a9def6faef63a8e506f79f106'),
 ('202610300003_gemini_lab','725b5f5a81ab322b9e8f92637756cb6129c8a0b484e929feec1f1f7a115de08d'),
 ('202610300004_guided_flows','7140c4729614f1393b7bdd80f24c6095ad33257c1cb43c06997bcd6202cffb80'),
 ('202610310001_dynamic_variables','75ee61cc6f534702e008f4cacff700b1046151bc7a2f1d4f27b90e6f9328fb74'),
 ('202611020001_contact_follow_up','de5778ca9ca13bd04c5f6b08ab06e4466c6f49d87e1be3420ff2c85e7feb7cc2'),
 ('202611050001_whatsapp_qr','7489f7a231bcf9ecf9fd27dceeba9a65e5767d18d388a48810ccd3e009d3de6b')) AS e(name,checksum) ON h.migration_name=e.name
   WHERE h.migration_name IS NULL OR e.name IS NULL OR h.checksum<>e.checksum OR h.finished_at IS NULL OR h.rolled_back_at IS NOT NULL
  ) OR EXISTS (SELECT migration_name FROM public._prisma_migrations GROUP BY migration_name HAVING count(*)<>1) THEN
   RAISE EXCEPTION 'MONZO: historial parcial o incompatible. No se modifico nada.';
  END IF;
  RAISE NOTICE 'MONZO: historial ya registrado y comprobado; no se modifico nada.';
  RETURN;
 END IF;
 FOR table_row IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'_prisma_migrations' ORDER BY c.relname COLLATE "C" LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I LIMIT 1)',table_row.relname) INTO contains_rows;
  IF contains_rows THEN RAISE EXCEPTION 'MONZO: la copia de pruebas contiene datos. No se registro historial.'; END IF;
 END LOOP;
 INSERT INTO public._prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count)
 SELECT md5('monzo-preview-baseline:'||name),checksum,now(),name,1 FROM (VALUES ('202610290001_foundation','63e19ab65a1822977618a1ca291a873a59e41954213523f700cffaeb9b4b2b13'),
 ('202610290002_auth_tenants','67f5c97d01f0dce37f5af81f2e5a6a4077c86d986fe59213f94b6b5350f99b8c'),
 ('202610290003_whatsapp_inbox','3b922830d49c8401a5a3b41ce5e8825e89e73ea42ff42e22102cc405deac5e63'),
 ('202610290004_event_dispatch','3224c27b344561a90ad42b9ba1c698edc819c39a9af75ca8bc871fe38f96ed21'),
 ('202610300001_whatsapp_media','7f6aa7ec2616ce537e8853b8f28b37d9fd0f630bda7b1283e50adef473b091cd'),
 ('202610300002_whatsapp_templates','8a8fbe181ca94118ed0b74c5fa246516ee0eb13a9def6faef63a8e506f79f106'),
 ('202610300003_gemini_lab','725b5f5a81ab322b9e8f92637756cb6129c8a0b484e929feec1f1f7a115de08d'),
 ('202610300004_guided_flows','7140c4729614f1393b7bdd80f24c6095ad33257c1cb43c06997bcd6202cffb80'),
 ('202610310001_dynamic_variables','75ee61cc6f534702e008f4cacff700b1046151bc7a2f1d4f27b90e6f9328fb74'),
 ('202611020001_contact_follow_up','de5778ca9ca13bd04c5f6b08ab06e4466c6f49d87e1be3420ff2c85e7feb7cc2'),
 ('202611050001_whatsapp_qr','7489f7a231bcf9ecf9fd27dceeba9a65e5767d18d388a48810ccd3e009d3de6b')) AS e(name,checksum);
 RAISE NOTICE 'MONZO: historial de once migraciones registrado sobre esquema comprobado y vacio.';
END
$monzo_preview_baseline$;

SELECT current_database() AS base,
 (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migraciones_registradas,
 (SELECT count(*) FROM public."User") AS usuarios,
 (SELECT count(*) FROM public."Tenant") AS empresas,
 (SELECT count(*) FROM public."Message") AS mensajes;
