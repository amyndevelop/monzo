import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const names = [
  '202610290001_foundation',
  '202610290002_auth_tenants',
  '202610290003_whatsapp_inbox',
  '202610290004_event_dispatch',
];
const migrations = names.map((name) => {
  const sql = readFileSync(new URL(`prisma/migrations/${name}/migration.sql`, root), 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const id = `${checksum.slice(0, 8)}-${checksum.slice(8, 12)}-4${checksum.slice(13, 16)}-a${checksum.slice(17, 20)}-${checksum.slice(20, 32)}`;
  return { name, sql, checksum, id };
});
const oldTables = [
  'User',
  'Tenant',
  'Membership',
  'TenantSettings',
  'Session',
  'Account',
  'Verification',
  'RateLimit',
  'TenantInvitation',
];
const newTables = [
  'WhatsappAccount',
  'Contact',
  'Conversation',
  'Message',
  'ConversationNote',
  'WhatsappWebhookEvent',
  'WorkerHeartbeat',
];
const array = (values) => `ARRAY[${values.map((v) => `'${v}'`).join(', ')}]`;
const checks = migrations
  .map(
    ({ name, checksum }) => `
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '${name}'
   AND (checksum <> '${checksum}' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN
  RAISE EXCEPTION 'MONZO: historial incompatible en ${name}. No se modifico nada.';
 END IF;`,
  )
  .join('\n');
const additions = migrations
  .slice(2)
  .map(
    ({ name, sql, checksum, id }) => `
-- ${name}; copia exacta de la migracion versionada.
${sql}
INSERT INTO public._prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count)
VALUES ('${id}', '${checksum}', now(), '${name}', 1);
`,
  )
  .join('\n');
const output = `-- MONZO Fase 3: actualizar monzo-db / main / neondb, que ya tiene Fase 2.
-- Ejecutar TODO el bloque. Una sola sentencia atomica: todo o nada.
-- Agrega las migraciones 3 y 4. No borra ni reemplaza usuarios, empresas o tablas.
-- Generado por node scripts/prepare-phase-3-sql.mjs; no editar ni ejecutar el bootstrap de Fase 2.
DO $monzo_phase_3$
DECLARE
 target_table text;
 applied integer;
BEGIN
 PERFORM pg_catalog.set_config('search_path', 'public', true);
 IF current_database() <> 'neondb' THEN
  RAISE EXCEPTION 'MONZO: elegi la base neondb antes de ejecutar. No se modifico nada.';
 END IF;
 IF to_regclass('public._prisma_migrations') IS NULL THEN
  RAISE EXCEPTION 'MONZO: falta el historial de Fase 2. No se modifico nada.';
 END IF;
 LOCK TABLE public._prisma_migrations IN EXCLUSIVE MODE;
 IF EXISTS (SELECT migration_name FROM public._prisma_migrations GROUP BY migration_name HAVING count(*) <> 1) THEN
  RAISE EXCEPTION 'MONZO: historial duplicado. No se modifico nada.';
 END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name <> ALL (${array(names)})) THEN
  RAISE EXCEPTION 'MONZO: hay migraciones no previstas. Revisar antes de continuar.';
 END IF;
${checks}
 IF (SELECT count(*) FROM public._prisma_migrations WHERE migration_name = ANY (${array(names.slice(0, 2))})) <> 2 THEN
  RAISE EXCEPTION 'MONZO: se esperan las dos migraciones de Fase 2, una vez cada una.';
 END IF;
 FOREACH target_table IN ARRAY ${array(oldTables)} LOOP
  IF to_regclass(format('public.%I', target_table)) IS NULL THEN
   RAISE EXCEPTION 'MONZO: falta la tabla % de Fase 2. No se modifico nada.', target_table;
  END IF;
 END LOOP;
 SELECT count(*) INTO applied FROM public._prisma_migrations WHERE migration_name = ANY (${array(names.slice(2))});
 IF applied = 2 AND (SELECT count(*) FROM public._prisma_migrations) = 4 THEN
  FOREACH target_table IN ARRAY ${array(newTables)} LOOP
   IF to_regclass(format('public.%I', target_table)) IS NULL THEN
    RAISE EXCEPTION 'MONZO: historial aplicado pero falta %. Revisar el esquema.', target_table;
   END IF;
  END LOOP;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
    AND table_name IN ('Message', 'WhatsappWebhookEvent') AND column_name = 'jobPublishedAt') <> 2 THEN
   RAISE EXCEPTION 'MONZO: historial aplicado pero faltan columnas. Revisar el esquema.';
  END IF;
  RAISE NOTICE 'MONZO: Fase 3 ya estaba aplicada; no se modificaron datos.';
  RETURN;
 END IF;
 IF applied <> 0 OR (SELECT count(*) FROM public._prisma_migrations) <> 2 THEN
  RAISE EXCEPTION 'MONZO: historial parcial o duplicado. No se modifico nada.';
 END IF;
 FOREACH target_table IN ARRAY ${array(newTables)} LOOP
  IF to_regclass(format('public.%I', target_table)) IS NOT NULL THEN
   RAISE EXCEPTION 'MONZO: ya existe % sin historial completo. Revisar antes de continuar.', target_table;
  END IF;
 END LOOP;
${additions}
 RAISE NOTICE 'MONZO: Fase 3 aplicada; cuatro migraciones registradas. Usuarios y empresas conservados.';
END
$monzo_phase_3$;
`;
const target = new URL('docs/sql/phase-3-upgrade.sql', root);
writeFileSync(target, output);
// A second layout is convenient for copying the entire statement from one chat code block.
// Only whole-line comments and whitespace of the mutation are changed; append the read-only check.
const verification = readFileSync(new URL('docs/sql/phase-3-verify.sql', root), 'utf8')
  .replace(/^--[^\n]*$/gm, '')
  .trim()
  .replace(/\s+/g, ' ');
const compact =
  output
    .replace(/^--[^\n]*$/gm, '')
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' '),
    )
    .join('\n') +
  '\n' +
  verification +
  '\n';
writeFileSync(new URL('docs/sql/phase-3-upgrade-compact.sql', root), compact);
console.log(
  `Prepared ${fileURLToPath(target)} with exact migration checksums; no database connection made.`,
);
