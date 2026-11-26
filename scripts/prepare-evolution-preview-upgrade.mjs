import { writeFileSync } from 'node:fs';
import {
  baselineMigrations,
  fingerprintSql,
  migrationTableSql,
} from './evolution-preview-baseline.mjs';
import { evolutionMigration, evolutionUpgradeSql } from './evolution-preview-upgrade.mjs';
import { localPreviewPostgres } from './evolution-preview-local-postgres.mjs';

const local = localPreviewPostgres();
try {
  local.create();
  const migrations = baselineMigrations();
  local.query(migrationTableSql + migrations.map((m) => m.sql).join('\n'));
  const fingerprint = () =>
    JSON.parse(local.query('SET search_path=public,pg_catalog;' + fingerprintSql + ';'));
  const before = fingerprint();
  local.query(evolutionMigration().sql);
  writeFileSync(
    'docs/sql/evolution-preview-upgrade.sql',
    evolutionUpgradeSql(migrations, before, fingerprint()),
  );
  console.log(
    'SQL Evolution para Preview preparado desde migraciones originales y esquema temporal local. No se accedio a Neon.',
  );
} finally {
  local.close();
}
