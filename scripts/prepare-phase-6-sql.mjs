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
];
const migrations = names.map((name) => {
  const sql = readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8');
  return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
});
const latest = migrations.at(-1);
const literalNames = names.map((name) => `'${name}'`).join(',');
const columns = [
  ...['id', 'tenantId', 'name', 'instructions', 'knowledge'].map((name) => [
    'AiAgent',
    name,
    'text',
    'NO',
  ]),
  ['AiAgent', 'enabled', 'boolean', 'NO'],
  ['AiAgent', 'dailyLimit', 'integer', 'NO'],
  ['AiAgent', 'revision', 'integer', 'NO'],
  ...['createdAt', 'updatedAt'].map((name) => [
    'AiAgent',
    name,
    'timestamp without time zone',
    'NO',
  ]),
];
const values = columns
  .map((row) => '(' + row.map((value) => `'${value}'`).join(',') + ')')
  .join(',');
const schemaCheck = `
 IF (SELECT count(*) FROM information_schema.columns c JOIN (VALUES ${values}) expected(tab,col,kind,nullable) ON c.table_name=expected.tab AND c.column_name=expected.col AND c.data_type=expected.kind AND c.is_nullable=expected.nullable WHERE c.table_schema='public') <> ${columns.length} THEN RAISE EXCEPTION 'MONZO: faltan columnas de Fase 6 o su tipo no coincide.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='AiAgent' AND column_name='enabled') IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'MONZO: agente debe comenzar pausado.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='AiAgent' AND column_name='dailyLimit') IS DISTINCT FROM '20' THEN RAISE EXCEPTION 'MONZO: limite inicial incompatible.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace='public'::regnamespace AND convalidated AND conname='AiAgent_tenantId_fkey') <> 1 THEN RAISE EXCEPTION 'MONZO: falta relacion de empresa del agente.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname='public' AND tablename='AiAgent' AND indexname IN ('AiAgent_pkey','AiAgent_tenantId_key')) <> 2 THEN RAISE EXCEPTION 'MONZO: faltan indices del agente.'; END IF;
`;
const verification = `SELECT current_database() AS base,
 (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='AiAgent') AS tabla_agente,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='AiAgent') AS columnas_agente,
 (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migraciones_aplicadas;
`;
const sql = `-- MONZO Fase 6: ejecutar TODO en neondb. Conserva cuentas, mensajes y adjuntos.
-- Actualizar la base ANTES de publicar el codigo de Fase 6.
-- Una sola transaccion atomica. Checksums generados desde migraciones originales.
DO $monzo_phase_6$
BEGIN
 PERFORM pg_catalog.set_config('search_path','public',true);
 IF current_database() <> 'neondb' THEN RAISE EXCEPTION 'MONZO: elegi la base neondb.'; END IF;
 IF to_regclass('public._prisma_migrations') IS NULL OR to_regclass('public."Message"') IS NULL THEN RAISE EXCEPTION 'MONZO: falta el esquema de Fase 5.'; END IF;
 LOCK TABLE public._prisma_migrations IN EXCLUSIVE MODE;
 IF EXISTS (SELECT migration_name FROM public._prisma_migrations GROUP BY migration_name HAVING count(*) <> 1) THEN RAISE EXCEPTION 'MONZO: historial duplicado.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name <> ALL(ARRAY[${literalNames}])) THEN RAISE EXCEPTION 'MONZO: hay migraciones no previstas.'; END IF;
${migrations.map(({ name, checksum }) => ` IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='${name}' AND (checksum<>'${checksum}' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en ${name}.'; END IF;`).join('\n')}
 IF (SELECT count(*) FROM public._prisma_migrations WHERE migration_name=ANY(ARRAY[${names
   .slice(0, -1)
   .map((name) => `'${name}'`)
   .join(',')}])) <> 6 THEN RAISE EXCEPTION 'MONZO: se esperan seis migraciones previas.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='${latest.name}') THEN
${schemaCheck}
  RAISE NOTICE 'MONZO: Fase 6 ya estaba aplicada. No se modificaron datos.';
  RETURN;
 END IF;
 IF to_regclass('public."AiAgent"') IS NOT NULL OR EXISTS (SELECT 1 FROM information_schema.columns c JOIN (VALUES ${values}) expected(tab,col,kind,nullable) ON c.table_name=expected.tab AND c.column_name=expected.col WHERE c.table_schema='public') THEN RAISE EXCEPTION 'MONZO: hay esquema sin historial de Fase 6. Revisar antes de continuar.'; END IF;
${latest.sql}
${schemaCheck}
 INSERT INTO public._prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count) VALUES ('${latest.checksum.slice(0, 8)}-${latest.checksum.slice(8, 12)}-4${latest.checksum.slice(13, 16)}-a${latest.checksum.slice(17, 20)}-${latest.checksum.slice(20, 32)}','${latest.checksum}',now(),'${latest.name}',1);
 RAISE NOTICE 'MONZO: Fase 6 aplicada. Datos existentes conservados.';
END
$monzo_phase_6$;

${verification}`;
writeFileSync('docs/sql/phase-6-upgrade.sql', sql);
writeFileSync('docs/sql/phase-6-verify.sql', verification);
console.log('Prepared Phase 6 SQL from exact migration bytes; no database connection made.');
