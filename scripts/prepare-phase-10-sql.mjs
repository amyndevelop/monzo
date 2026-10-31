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
];
const migrations = names.map((name) => {
  const sql = readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8');
  return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
});
const latest = migrations.at(-1);
const columns = [
  ...['id', 'tenantId', 'name', 'identifier', 'type', 'description', 'scope', 'currency'].map(
    (c) => [c, 'text', 'NO'],
  ),
  ['defaultValue', 'text', 'YES'],
  ['revision', 'integer', 'NO'],
  ['createdAt', 'timestamp without time zone', 'NO'],
  ['updatedAt', 'timestamp without time zone', 'NO'],
];
const check = `
 IF (SELECT count(*) FROM information_schema.columns c JOIN (VALUES ${columns.map((row) => '(' + row.map((v) => `'${v}'`).join(',') + ')').join(',')}) e(col,kind,nullable) ON c.column_name=e.col AND c.data_type=e.kind AND c.is_nullable=e.nullable WHERE c.table_schema='public' AND c.table_name='AutomationVariable') <> 12 THEN RAISE EXCEPTION 'MONZO: esquema de variables incompatible.'; END IF;
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='AutomationVariable') <> 12 THEN RAISE EXCEPTION 'MONZO: columnas de variables inesperadas.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace='public'::regnamespace AND conrelid='public."AutomationVariable"'::regclass AND convalidated AND conname IN ('AutomationVariable_pkey','AutomationVariable_tenantId_fkey','AutomationVariable_identifier_check','AutomationVariable_type_check','AutomationVariable_scope_check')) <> 5 THEN RAISE EXCEPTION 'MONZO: faltan restricciones de variables.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname='public' AND indexname IN ('AutomationVariable_pkey','AutomationVariable_tenantId_identifier_key')) <> 2 THEN RAISE EXCEPTION 'MONZO: faltan indices de variables.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='AutomationVariable' AND column_name='scope') IS DISTINCT FROM '''execution''::text' THEN RAISE EXCEPTION 'MONZO: alcance inicial incompatible.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='AutomationVariable' AND column_name='revision') IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'MONZO: revision inicial incompatible.'; END IF;
`;
const verification = `SELECT current_database() AS base,
 (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='AutomationVariable') AS tabla_variables,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='AutomationVariable') AS columnas_variables,
 (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migraciones_aplicadas;\n`;
const sql = `-- MONZO: ejecutar TODO en neondb antes de publicar variables dinamicas.
-- Solo agrega el catalogo e importa identificadores heredados. No cambia flujos, valores ni mensajes.
DO $monzo_phase_10$
BEGIN
 PERFORM pg_catalog.set_config('search_path','public',true);
 IF current_database()<>'neondb' THEN RAISE EXCEPTION 'MONZO: elegi la base neondb.'; END IF;
 IF to_regclass('public._prisma_migrations') IS NULL OR to_regclass('public."AutomationFlow"') IS NULL THEN RAISE EXCEPTION 'MONZO: falta el esquema previo.'; END IF;
 LOCK TABLE public._prisma_migrations IN EXCLUSIVE MODE;
 IF EXISTS (SELECT migration_name FROM public._prisma_migrations GROUP BY migration_name HAVING count(*)<>1) THEN RAISE EXCEPTION 'MONZO: historial duplicado.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name<>ALL(ARRAY[${names.map((n) => `'${n}'`).join(',')}])) THEN RAISE EXCEPTION 'MONZO: hay migraciones no previstas.'; END IF;
${migrations.map((m) => ` IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='${m.name}' AND (checksum<>'${m.checksum}' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en ${m.name}.'; END IF;`).join('\n')}
 IF (SELECT count(*) FROM public._prisma_migrations WHERE migration_name=ANY(ARRAY[${names
   .slice(0, -1)
   .map((n) => `'${n}'`)
   .join(',')}]))<>8 THEN RAISE EXCEPTION 'MONZO: se esperan ocho migraciones previas.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='${latest.name}') THEN
${check}
 RAISE NOTICE 'MONZO: variables ya aplicadas; datos conservados.'; RETURN;
 END IF;
 IF to_regclass('public."AutomationVariable"') IS NOT NULL THEN RAISE EXCEPTION 'MONZO: hay esquema sin historial de variables.'; END IF;
${latest.sql}
${check}
 INSERT INTO public._prisma_migrations (id,checksum,finished_at,migration_name,applied_steps_count) VALUES (md5(random()::text||clock_timestamp()::text),'${latest.checksum}',now(),'${latest.name}',1);
 RAISE NOTICE 'MONZO: variables aplicadas; historial y conversaciones conservados.';
END
$monzo_phase_10$;

${verification}`;
writeFileSync('docs/sql/phase-10-upgrade.sql', sql);
writeFileSync('docs/sql/phase-10-verify.sql', verification);
console.log(
  'Prepared variable catalog SQL from exact migration bytes; no database connection made.',
);
