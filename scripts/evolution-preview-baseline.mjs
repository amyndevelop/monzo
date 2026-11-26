import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

export function baselineMigrations() {
  const names = readdirSync('prisma/migrations')
    .filter((name) => /^\d{12}_/.test(name))
    .sort();
  if (names.length !== 11 || names.at(-1) !== '202611050001_whatsapp_qr')
    throw new Error('Review the schema-only baseline before including another migration.');
  return names.map((name) => {
    const sql = readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
}

// Ignore owners/OIDs/statistics/data. Preserve the actual DDL, constraints and index definitions.
export const fingerprintSql = `WITH items AS (
 SELECT 'relations' AS kind, jsonb_build_array(c.relname,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity) AS item
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')
 UNION ALL
 SELECT 'columns',jsonb_build_array(c.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),co.collname)
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum LEFT JOIN pg_collation co ON co.oid=a.attcollation
 WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL
 SELECT 'constraints',jsonb_build_array(c.relname,k.conname,k.contype,k.convalidated,k.condeferrable,k.condeferred,pg_get_constraintdef(k.oid,false))
 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
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
 SELECT kind,encode(sha256(convert_to(string_agg(item::text,E'\\n' ORDER BY item::text COLLATE "C"),'UTF8')),'hex') AS digest FROM items GROUP BY kind
)
SELECT jsonb_object_agg(kind,digest) FROM fingerprints`;

export const migrationTableSql = `CREATE TABLE public._prisma_migrations (
 id VARCHAR(36) NOT NULL PRIMARY KEY, checksum VARCHAR(64) NOT NULL,
 finished_at TIMESTAMPTZ, migration_name VARCHAR(255) NOT NULL, logs TEXT,
 rolled_back_at TIMESTAMPTZ, started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 applied_steps_count INTEGER NOT NULL DEFAULT 0
);`;

export function baselineSql(migrations, fingerprint, database = 'neondb') {
  if (
    !/^[a-z][a-z0-9_]{0,62}$/.test(database) ||
    migrations.length !== 11 ||
    !['relations', 'columns', 'constraints', 'indexes', 'enums'].every((kind) =>
      /^[a-f0-9]{64}$/.test(fingerprint[kind]),
    )
  )
    throw new Error('Invalid baseline reference.');
  for (const migration of migrations)
    if (!/^\d{12}_[a-z0-9_]+$/.test(migration.name) || !/^[a-f0-9]{64}$/.test(migration.checksum))
      throw new Error('Invalid migration reference.');
  const values = migrations.map((m) => `('${m.name}','${m.checksum}')`).join(',\n ');
  const expected = JSON.stringify(fingerprint);
  return `-- MONZO: SOLO en Neon / monzo-evolution-test / neondb, copia Branch schema only.
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
 IF current_database()<>'${database}' THEN RAISE EXCEPTION 'MONZO: selecciona neondb en la rama de pruebas.'; END IF;
 IF to_regclass('public._prisma_migrations') IS NULL THEN RAISE EXCEPTION 'MONZO: falta el esquema copiado. No se modifico nada.'; END IF;
 FOR table_row IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname COLLATE "C" LOOP
  EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',table_row.relname);
 END LOOP;
 ${fingerprintSql.replace('SELECT jsonb_object_agg(kind,digest)', 'SELECT jsonb_object_agg(kind,digest) INTO actual_fingerprint')};
 IF actual_fingerprint IS DISTINCT FROM '${expected}'::jsonb THEN
  SELECT string_agg(key,', ' ORDER BY key) INTO different_sections FROM jsonb_object_keys(COALESCE(actual_fingerprint,'{}'::jsonb)||'${expected}'::jsonb) AS k(key)
  WHERE actual_fingerprint->key IS DISTINCT FROM '${expected}'::jsonb->key;
  RAISE EXCEPTION 'MONZO: estructura incompatible (%). No se registro historial.',different_sections;
 END IF;
 SELECT count(*) INTO history_count FROM public._prisma_migrations;
 IF history_count>0 THEN
  IF history_count<>11 OR EXISTS (
   SELECT 1 FROM public._prisma_migrations h FULL JOIN (VALUES ${values}) AS e(name,checksum) ON h.migration_name=e.name
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
 SELECT md5('monzo-preview-baseline:'||name),checksum,now(),name,1 FROM (VALUES ${values}) AS e(name,checksum);
 RAISE NOTICE 'MONZO: historial de once migraciones registrado sobre esquema comprobado y vacio.';
END
$monzo_preview_baseline$;

SELECT current_database() AS base,
 (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migraciones_registradas,
 (SELECT count(*) FROM public."User") AS usuarios,
 (SELECT count(*) FROM public."Tenant") AS empresas,
 (SELECT count(*) FROM public."Message") AS mensajes;
`;
}
