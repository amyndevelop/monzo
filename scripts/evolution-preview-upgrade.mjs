import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fingerprintSql, notNullValidationSql } from './evolution-preview-baseline.mjs';

export const evolutionMigrationName = '202611260001_evolution_channels';
export function evolutionMigration() {
  const sql = readFileSync(`prisma/migrations/${evolutionMigrationName}/migration.sql`, 'utf8');
  return {
    name: evolutionMigrationName,
    sql,
    checksum: createHash('sha256').update(sql).digest('hex'),
  };
}
export function evolutionUpgradeSql(
  priorMigrations,
  previousFingerprint,
  nextFingerprint,
  database = 'neondb',
) {
  if (priorMigrations.length !== 11 || !/^[a-z][a-z0-9_]{0,62}$/.test(database))
    throw new Error('Unexpected Evolution upgrade reference.');
  const migration = evolutionMigration();
  const migrations = [...priorMigrations, migration];
  for (const record of migrations)
    if (!/^\d{12}_[a-z0-9_]+$/.test(record.name) || !/^[a-f0-9]{64}$/.test(record.checksum))
      throw new Error('Invalid migration reference.');
  for (const fingerprint of [previousFingerprint, nextFingerprint])
    if (
      !['columns', 'constraints', 'indexes', 'enums', 'relations'].every((key) =>
        /^[a-f0-9]{64}$/.test(fingerprint[key]),
      )
    )
      throw new Error('Invalid schema reference.');
  const values = migrations.map((m) => `('${m.name}','${m.checksum}')`).join(',\n ');
  return `-- MONZO Evolution: SOLO monzo-evolution-test / neondb. Ejecutar TODO el archivo.
-- Requiere la marca del baseline de pruebas; rechaza el historial original de produccion.
-- Atomico y repetible. Conserva usuarios, empresas, mensajes y configuraciones anteriores.
DO $monzo_evolution_preview_upgrade$
DECLARE actual_fingerprint jsonb; expected_fingerprint jsonb; different_sections text; table_row record; applied boolean;
BEGIN
 PERFORM pg_catalog.set_config('search_path','public,pg_catalog',true);
 PERFORM pg_catalog.set_config('lock_timeout','5s',true);
 IF current_database()<>'${database}' OR to_regclass('public._prisma_migrations') IS NULL THEN RAISE EXCEPTION 'MONZO: selecciona la base de pruebas preparada.'; END IF;
 FOR table_row IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname COLLATE "C" LOOP
  EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',table_row.relname);
 END LOOP;
 IF EXISTS(SELECT migration_name FROM _prisma_migrations GROUP BY migration_name HAVING count(*)<>1) OR
 EXISTS(SELECT 1 FROM _prisma_migrations h LEFT JOIN (VALUES ${values}) AS e(name,checksum) ON h.migration_name=e.name
 WHERE e.name IS NULL OR h.checksum<>e.checksum OR h.finished_at IS NULL OR h.rolled_back_at IS NOT NULL) OR
 (SELECT count(*) FROM _prisma_migrations WHERE migration_name<>'${migration.name}')<>11 THEN
  RAISE EXCEPTION 'MONZO: historial previo incompatible. No se modifico nada.';
 END IF;
 IF EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name<>'${migration.name}' AND id<>md5('monzo-preview-baseline:'||migration_name)) THEN
  RAISE EXCEPTION 'MONZO: falta la marca del baseline de pruebas. No ejecutar en produccion.';
 END IF;
 SELECT EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name='${migration.name}') INTO applied;
 expected_fingerprint=CASE WHEN applied THEN '${JSON.stringify(nextFingerprint)}'::jsonb ELSE '${JSON.stringify(previousFingerprint)}'::jsonb END;
${notNullValidationSql}
 ${fingerprintSql.replace('SELECT jsonb_object_agg(kind,digest)', 'SELECT jsonb_object_agg(kind,digest) INTO actual_fingerprint')};
 IF actual_fingerprint IS DISTINCT FROM expected_fingerprint THEN
  SELECT string_agg(key,', ' ORDER BY key) INTO different_sections FROM jsonb_object_keys(COALESCE(actual_fingerprint,'{}'::jsonb)||expected_fingerprint) AS k(key) WHERE actual_fingerprint->key IS DISTINCT FROM expected_fingerprint->key;
  RAISE EXCEPTION 'MONZO: estructura incompatible (%). No se modifico nada.',different_sections;
 END IF;
 IF NOT applied THEN
${migration.sql}
 INSERT INTO public._prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count)
 VALUES(md5('monzo-preview-evolution:${migration.name}'),'${migration.checksum}',now(),'${migration.name}',1);
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
`;
}
