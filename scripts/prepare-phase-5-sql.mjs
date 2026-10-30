import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const names = [
  '202610290001_foundation',
  '202610290002_auth_tenants',
  '202610290003_whatsapp_inbox',
  '202610290004_event_dispatch',
  '202610300001_whatsapp_media',
  '202610300002_whatsapp_templates',
];
const migrations = names.map((name) => {
  const sql = readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8');
  return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
});
const latest = migrations.at(-1);
const literalNames = names.map((name) => `'${name}'`).join(',');
const columns = [
  ['Message', 'templateId', 'text', 'YES'],
  ['Message', 'templateSnapshot', 'jsonb', 'YES'],
  ['WhatsappAccount', 'templatesNextCursor', 'text', 'YES'],
  ['WhatsappAccount', 'templatesSyncId', 'text', 'YES'],
  ['WhatsappAccount', 'templatesSyncVersion', 'integer', 'NO'],
  ['WhatsappAccount', 'templatesSyncedAt', 'timestamp without time zone', 'YES'],
  ...[
    'id',
    'tenantId',
    'accountId',
    'businessAccountId',
    'providerId',
    'name',
    'language',
    'category',
    'status',
    'definitionHash',
    'syncId',
  ].map((name) => ['WhatsappTemplate', name, 'text', 'NO']),
  ['WhatsappTemplate', 'definition', 'jsonb', 'NO'],
  ...['syncedAt', 'createdAt', 'updatedAt'].map((name) => [
    'WhatsappTemplate',
    name,
    'timestamp without time zone',
    'NO',
  ]),
];
const values = columns
  .map((row) => '(' + row.map((value) => `'${value}'`).join(',') + ')')
  .join(',');
const schemaCheck = `
 IF (SELECT count(*) FROM information_schema.columns c JOIN (VALUES ${values}) expected(tab,col,kind,nullable) ON c.table_name=expected.tab AND c.column_name=expected.col AND c.data_type=expected.kind AND c.is_nullable=expected.nullable WHERE c.table_schema='public') <> ${columns.length} THEN RAISE EXCEPTION 'MONZO: faltan columnas de Fase 5 o su tipo no coincide.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='WhatsappAccount' AND column_name='templatesSyncVersion') IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'MONZO: valor inicial del catalogo incompatible.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace='public'::regnamespace AND convalidated AND conname IN ('Message_templateId_accountId_tenantId_fkey','WhatsappTemplate_tenantId_fkey','WhatsappTemplate_accountId_tenantId_fkey')) <> 3 THEN RAISE EXCEPTION 'MONZO: faltan relaciones de Fase 5.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname='public' AND tablename='WhatsappTemplate' AND indexname IN ('WhatsappTemplate_pkey','WhatsappTemplate_tenantId_accountId_status_idx','WhatsappTemplate_id_accountId_tenantId_key','WhatsappTemplate_accountId_providerId_key','WhatsappTemplate_accountId_name_language_key')) <> 5 THEN RAISE EXCEPTION 'MONZO: faltan indices de Fase 5.'; END IF;
`;
const verification = `SELECT current_database() AS base,
 (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='WhatsappTemplate') AS tabla_plantillas,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Message' AND column_name IN ('templateId','templateSnapshot')) AS columnas_mensajes,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='WhatsappAccount' AND column_name IN ('templatesSyncedAt','templatesNextCursor','templatesSyncId','templatesSyncVersion')) AS columnas_catalogo,
 (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migraciones_aplicadas;
`;
const sql = `-- MONZO Fase 5: ejecutar TODO en neondb. Conserva cuentas, mensajes y adjuntos.
-- Actualizar la base ANTES de publicar el codigo de Fase 5.
-- Una sola transaccion atomica. Checksums generados desde migraciones originales.
DO $monzo_phase_5$
BEGIN
 PERFORM pg_catalog.set_config('search_path','public',true);
 IF current_database() <> 'neondb' THEN RAISE EXCEPTION 'MONZO: elegi la base neondb.'; END IF;
 IF to_regclass('public._prisma_migrations') IS NULL OR to_regclass('public."Message"') IS NULL THEN RAISE EXCEPTION 'MONZO: falta el esquema de Fase 4.'; END IF;
 LOCK TABLE public._prisma_migrations IN EXCLUSIVE MODE;
 IF EXISTS (SELECT migration_name FROM public._prisma_migrations GROUP BY migration_name HAVING count(*) <> 1) THEN RAISE EXCEPTION 'MONZO: historial duplicado.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name <> ALL(ARRAY[${literalNames}])) THEN RAISE EXCEPTION 'MONZO: hay migraciones no previstas.'; END IF;
${migrations.map(({ name, checksum }) => ` IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='${name}' AND (checksum<>'${checksum}' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en ${name}.'; END IF;`).join('\n')}
 IF (SELECT count(*) FROM public._prisma_migrations WHERE migration_name=ANY(ARRAY[${names
   .slice(0, -1)
   .map((name) => `'${name}'`)
   .join(',')}])) <> 5 THEN RAISE EXCEPTION 'MONZO: se esperan cinco migraciones previas.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name='${latest.name}') THEN
${schemaCheck}
  RAISE NOTICE 'MONZO: Fase 5 ya estaba aplicada. No se modificaron datos.';
  RETURN;
 END IF;
 IF to_regclass('public."WhatsappTemplate"') IS NOT NULL OR EXISTS (SELECT 1 FROM information_schema.columns c JOIN (VALUES ${values}) expected(tab,col,kind,nullable) ON c.table_name=expected.tab AND c.column_name=expected.col WHERE c.table_schema='public') THEN RAISE EXCEPTION 'MONZO: hay esquema sin historial de Fase 5. Revisar antes de continuar.'; END IF;
${latest.sql}
${schemaCheck}
 INSERT INTO public._prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count) VALUES ('${latest.checksum.slice(0, 8)}-${latest.checksum.slice(8, 12)}-4${latest.checksum.slice(13, 16)}-a${latest.checksum.slice(17, 20)}-${latest.checksum.slice(20, 32)}','${latest.checksum}',now(),'${latest.name}',1);
 RAISE NOTICE 'MONZO: Fase 5 aplicada. Datos existentes conservados.';
END
$monzo_phase_5$;

${verification}`;
writeFileSync('docs/sql/phase-5-upgrade.sql', sql);
writeFileSync('docs/sql/phase-5-verify.sql', verification);
console.log('Prepared Phase 5 SQL from exact migration bytes; no database connection made.');
