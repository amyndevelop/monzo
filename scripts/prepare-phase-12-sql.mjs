import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const names = readdirSync('prisma/migrations')
  .filter((n) => /^\d{12}_/.test(n))
  .sort();
if (names.length !== 11 || names.at(-1) !== '202611050001_whatsapp_qr')
  throw new Error('Review migration list before regenerating QR SQL.');
const migrations = names.map((name) => {
  const sql = readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8');
  return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
});
const contact = migrations.at(-2),
  qr = migrations.at(-1);
const contactColumns = [
  'crmName',
  'email',
  'company',
  'salesStage',
  'tags',
  'ownerUserId',
  'profileNotes',
  'crmRevision',
];
const sessionColumns = [
  'accountId',
  'tenantId',
  'expectedWaId',
  'connectedWaId',
  'desiredState',
  'state',
  'generation',
  'authEncrypted',
  'qrEncrypted',
  'qrExpiresAt',
  'leaseOwner',
  'leaseUntil',
  'lastErrorCode',
  'createdAt',
  'updatedAt',
];
const contactCheck = ` IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Contact' AND column_name=ANY(ARRAY[${contactColumns.map((c) => `'${c}'`).join(',')}]))<>8 THEN RAISE EXCEPTION 'MONZO: esquema comercial incompatible.'; END IF;`;
const qrCheck = `
 IF to_regclass('public."WhatsappWebSession"') IS NULL THEN RAISE EXCEPTION 'MONZO: falta la tabla de sesiones QR.'; END IF;
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='WhatsappWebSession' AND column_name=ANY(ARRAY[${sessionColumns.map((c) => `'${c}'`).join(',')}]))<>15 THEN RAISE EXCEPTION 'MONZO: columnas QR incompatibles.'; END IF;
 IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='WhatsappAccount' AND column_name='provider') IS DISTINCT FROM '''META''::text' THEN RAISE EXCEPTION 'MONZO: proveedor inicial incompatible.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace='public'::regnamespace AND convalidated AND conname IN ('WhatsappAccount_provider_check','WhatsappWebSession_pkey','WhatsappWebSession_accountId_tenantId_fkey','WhatsappWebSession_desired_check','WhatsappWebSession_state_check','WhatsappWebSession_number_check'))<>6 THEN RAISE EXCEPTION 'MONZO: faltan restricciones QR.'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname='public' AND indexname IN ('WhatsappWebSession_pkey','WhatsappWebSession_tenantId_idx','WhatsappWebSession_accountId_tenantId_key'))<>3 THEN RAISE EXCEPTION 'MONZO: faltan indices QR.'; END IF;
`;
const verification = `SELECT current_database() AS base,
 (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='WhatsappWebSession') AS tabla_sesion_qr,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='WhatsappWebSession') AS columnas_sesion_qr,
 (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migraciones_aplicadas;\n`;
const record = (m) =>
  ` INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count) VALUES(md5(random()::text||clock_timestamp()::text),'${m.checksum}',now(),'${m.name}',1);`;
const sql = `-- MONZO QR: ejecutar TODO en neondb. Incluye Contactos si su migracion aun no fue aplicada.
-- Operacion atomica y repetible. Conserva los canales oficiales, mensajes y fichas existentes.
DO $monzo_phase_12$
BEGIN
 PERFORM pg_catalog.set_config('search_path','public',true);
 IF current_database()<>'neondb' THEN RAISE EXCEPTION 'MONZO: elegi la base neondb.'; END IF;
 IF to_regclass('public._prisma_migrations') IS NULL OR to_regclass('public."WhatsappAccount"') IS NULL THEN RAISE EXCEPTION 'MONZO: falta el esquema previo.'; END IF;
 LOCK TABLE _prisma_migrations IN EXCLUSIVE MODE;
 IF EXISTS (SELECT migration_name FROM _prisma_migrations GROUP BY migration_name HAVING count(*)<>1) THEN RAISE EXCEPTION 'MONZO: historial duplicado.'; END IF;
 IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name<>ALL(ARRAY[${names.map((n) => `'${n}'`).join(',')}])) THEN RAISE EXCEPTION 'MONZO: hay migraciones no previstas.'; END IF;
${migrations.map((m) => ` IF EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name='${m.name}' AND(checksum<>'${m.checksum}' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en ${m.name}.'; END IF;`).join('\n')}
 IF (SELECT count(*) FROM _prisma_migrations WHERE migration_name=ANY(ARRAY[${names
   .slice(0, 9)
   .map((n) => `'${n}'`)
   .join(',')}]))<>9 THEN RAISE EXCEPTION 'MONZO: se esperan nueve migraciones previas.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name='${contact.name}') THEN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Contact' AND column_name=ANY(ARRAY[${contactColumns.map((c) => `'${c}'`).join(',')}])) THEN RAISE EXCEPTION 'MONZO: hay campos comerciales sin historial.'; END IF;
${contact.sql}
${record(contact)}
 END IF;
${contactCheck}
 IF NOT EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name='${qr.name}') THEN
 IF to_regclass('public."WhatsappWebSession"') IS NOT NULL OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='WhatsappAccount' AND column_name='provider') THEN RAISE EXCEPTION 'MONZO: hay esquema QR sin historial.'; END IF;
${qr.sql}
${record(qr)}
 END IF;
${qrCheck}
 RAISE NOTICE 'MONZO: esquema QR preparado; datos existentes conservados. Esto no vincula ningun telefono.';
END
$monzo_phase_12$;

${verification}`;
writeFileSync('docs/sql/phase-12-upgrade.sql', sql);
writeFileSync('docs/sql/phase-12-verify.sql', verification);
console.log('Prepared combined QR SQL from original migration bytes; no database connection made.');
