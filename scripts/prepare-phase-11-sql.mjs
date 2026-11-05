import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const names = [
  '202610290001_foundation',
  '202610290002_auth_tenants',
  '202610290003_whatsapp_inbox',
  '202610290004_event_dispatch',
  '202610300001_whatsapp_media',
  '202610300002_whatsapp_templates',
  '202610300003_gemini_lab',
  '202610300004_guided_flows',
  '202610310001_dynamic_variables',
  '202611020001_contact_follow_up',
];
const migrations = names.map((name) => {
  const sql = readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8');
  return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
});
const latest = migrations.at(-1);
const columns = [
  'crmName',
  'email',
  'company',
  'salesStage',
  'tags',
  'ownerUserId',
  'profileNotes',
  'crmRevision',
];
const check = `
 IF (SELECT count(*) FROM information_schema.columns c JOIN (VALUES
 ('crmName','text','YES'),('email','text','YES'),('company','text','YES'),('salesStage','text','NO'),
 ('tags','ARRAY','NO'),('ownerUserId','text','YES'),('profileNotes','text','YES'),('crmRevision','integer','NO')
 ) e(col,kind,nullable) ON c.column_name=e.col AND c.data_type=e.kind AND c.is_nullable=e.nullable
 WHERE c.table_schema='public' AND c.table_name='Contact')<>8 THEN RAISE EXCEPTION 'MONZO: esquema comercial incompatible.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace='public'::regnamespace AND conrelid='public."Contact"'::regclass AND convalidated AND conname IN ('Contact_salesStage_check','Contact_ownerUserId_fkey'))<>2 THEN RAISE EXCEPTION 'MONZO: faltan restricciones de seguimiento.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname='public' AND indexname IN ('Contact_tenantId_salesStage_updatedAt_idx','Contact_ownerUserId_idx'))<>2 THEN RAISE EXCEPTION 'MONZO: faltan indices de seguimiento.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='Contact' AND column_name='salesStage') IS DISTINCT FROM '''NEW''::text' THEN RAISE EXCEPTION 'MONZO: estado inicial incompatible.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='Contact' AND column_name='crmRevision') IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'MONZO: revision inicial incompatible.'; END IF;
`;
const verification = `SELECT current_database() AS base,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Contact' AND column_name IN (${columns.map((c) => `'${c}'`).join(',')})) AS columnas_seguimiento,
 (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migraciones_aplicadas;\n`;
const sql = `-- MONZO fase 11: ejecutar TODO en neondb antes de publicar 0.3.0.
-- Agrega campos comerciales sin modificar mensajes, flujos, credenciales ni contactos existentes.
DO $monzo_phase_11$
BEGIN
 PERFORM pg_catalog.set_config('search_path','public',true);
 IF current_database()<>'neondb' THEN RAISE EXCEPTION 'MONZO: elegi la base neondb.'; END IF;
 IF to_regclass('public._prisma_migrations') IS NULL OR to_regclass('public."Contact"') IS NULL THEN RAISE EXCEPTION 'MONZO: falta el esquema previo.'; END IF;
 LOCK TABLE public._prisma_migrations IN EXCLUSIVE MODE;
 IF EXISTS (SELECT migration_name FROM public._prisma_migrations GROUP BY migration_name HAVING count(*)<>1) THEN RAISE EXCEPTION 'MONZO: historial duplicado.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name<>ALL(ARRAY[${names.map((n) => `'${n}'`).join(',')}])) THEN RAISE EXCEPTION 'MONZO: hay migraciones no previstas.'; END IF;
${migrations.map((m) => ` IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='${m.name}' AND (checksum<>'${m.checksum}' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en ${m.name}.'; END IF;`).join('\n')}
 IF (SELECT count(*) FROM public._prisma_migrations WHERE migration_name=ANY(ARRAY[${names
   .slice(0, -1)
   .map((n) => `'${n}'`)
   .join(',')}]))<>9 THEN RAISE EXCEPTION 'MONZO: se esperan nueve migraciones previas.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='${latest.name}') THEN
${check}
 RAISE NOTICE 'MONZO: seguimiento ya aplicado; datos conservados.'; RETURN;
 END IF;
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Contact' AND column_name=ANY(ARRAY[${columns.map((c) => `'${c}'`).join(',')}])) THEN RAISE EXCEPTION 'MONZO: hay campos comerciales sin historial.'; END IF;
${latest.sql}
${check}
 INSERT INTO public._prisma_migrations (id,checksum,finished_at,migration_name,applied_steps_count) VALUES (md5(random()::text||clock_timestamp()::text),'${latest.checksum}',now(),'${latest.name}',1);
 RAISE NOTICE 'MONZO: seguimiento aplicado; contactos y conversaciones conservados.';
END
$monzo_phase_11$;

${verification}`;
writeFileSync('docs/sql/phase-11-upgrade.sql', sql);
writeFileSync('docs/sql/phase-11-verify.sql', verification);
console.log('Prepared contact follow-up SQL; no database connection made.');
