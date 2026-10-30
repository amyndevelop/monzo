import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const names = [
  '202610290001_foundation',
  '202610290002_auth_tenants',
  '202610290003_whatsapp_inbox',
  '202610290004_event_dispatch',
  '202610300001_whatsapp_media',
];
const migrations = names.map((name) => {
  const sql = readFileSync(new URL(`prisma/migrations/${name}/migration.sql`, root), 'utf8');
  return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
});
const latest = migrations.at(-1);
const literalNames = names.map((name) => `'${name}'`).join(', ');
const checks = migrations
  .map(
    ({ name, checksum }) =>
      ` IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '${name}' AND (checksum <> '${checksum}' OR finished_at IS NULL OR rolled_back_at IS NOT NULL)) THEN RAISE EXCEPTION 'MONZO: historial incompatible en ${name}.'; END IF;`,
  )
  .join('\n');
const columns =
  "('mediaMimeType','text'), ('mediaFilename','text'), ('mediaSize','integer'), ('mediaSha256','text')";
const sql = `-- MONZO Fase 4: base neondb; ejecutar TODO el archivo.
-- Una sola transaccion DO: conserva mensajes, cuentas y empresas. No repetir Fase 2 o 3.
-- Generado desde las migraciones versionadas; no editar los checksums.
DO $monzo_phase_4$
BEGIN
 PERFORM pg_catalog.set_config('search_path', 'public', true);
 IF current_database() <> 'neondb' THEN RAISE EXCEPTION 'MONZO: elegi la base neondb.'; END IF;
 IF to_regclass('public._prisma_migrations') IS NULL OR to_regclass('public."Message"') IS NULL THEN RAISE EXCEPTION 'MONZO: falta el esquema de Fase 3.'; END IF;
 LOCK TABLE public._prisma_migrations IN EXCLUSIVE MODE;
 IF EXISTS (SELECT migration_name FROM public._prisma_migrations GROUP BY migration_name HAVING count(*) <> 1) THEN RAISE EXCEPTION 'MONZO: historial duplicado.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name <> ALL (ARRAY[${literalNames}])) THEN RAISE EXCEPTION 'MONZO: hay migraciones no previstas.'; END IF;
${checks}
 IF (SELECT count(*) FROM public._prisma_migrations WHERE migration_name = ANY (ARRAY[${names
   .slice(0, 4)
   .map((name) => `'${name}'`)
   .join(
     ', ',
   )}])) <> 4 THEN RAISE EXCEPTION 'MONZO: se esperan cuatro migraciones previas.'; END IF;
 IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '${latest.name}') THEN
  IF (SELECT count(*) FROM information_schema.columns c JOIN (VALUES ${columns}) AS expected(name, kind) ON c.column_name = expected.name AND c.data_type = expected.kind WHERE c.table_schema='public' AND c.table_name='Message' AND c.is_nullable='YES') <> 4 THEN RAISE EXCEPTION 'MONZO: historial aplicado pero faltan columnas o su tipo no coincide.'; END IF;
  RAISE NOTICE 'MONZO: Fase 4 ya estaba aplicada. No se modificaron datos.';
  RETURN;
 END IF;
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Message' AND column_name IN ('mediaMimeType','mediaFilename','mediaSize','mediaSha256')) THEN RAISE EXCEPTION 'MONZO: hay columnas sin historial de Fase 4. Revisar antes de continuar.'; END IF;
${latest.sql}
 INSERT INTO public._prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ('${latest.checksum.slice(0, 8)}-${latest.checksum.slice(8, 12)}-4${latest.checksum.slice(13, 16)}-a${latest.checksum.slice(17, 20)}-${latest.checksum.slice(20, 32)}', '${latest.checksum}', now(), '${latest.name}', 1);
 RAISE NOTICE 'MONZO: Fase 4 aplicada. Datos existentes conservados.';
END
$monzo_phase_4$;
`;
const verification = `SELECT current_database() AS base,
 (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Message' AND column_name IN ('mediaMimeType','mediaFilename','mediaSize','mediaSha256')) AS columnas_adjuntos,
 (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migraciones_aplicadas;
`;
writeFileSync(new URL('docs/sql/phase-4-upgrade.sql', root), sql + '\n' + verification);
writeFileSync(new URL('docs/sql/phase-4-verify.sql', root), verification);
console.log(
  'Prepared phase-4 upgrade and verification SQL from exact migration bytes; no database connection made.',
);
