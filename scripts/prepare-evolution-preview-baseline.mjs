import { writeFileSync } from 'node:fs';
import {
  baselineMigrations,
  baselineSql,
  fingerprintSql,
  migrationTableSql,
} from './evolution-preview-baseline.mjs';
import { localPreviewPostgres } from './evolution-preview-local-postgres.mjs';

const migrations = baselineMigrations();
const local = localPreviewPostgres();
try {
  local.create();
  local.query(migrationTableSql + migrations.map((m) => m.sql).join('\n'));
  const fingerprint = JSON.parse(
    local.query('SET search_path=public,pg_catalog;\n' + fingerprintSql + ';'),
  );
  const sql = baselineSql(migrations, fingerprint);
  writeFileSync('docs/sql/evolution-preview-baseline.sql', sql);
  console.log(
    'Historial Preview preparado desde once migraciones y esquema temporal local. No se accedio a Neon ni a bases de aplicacion.',
  );
} finally {
  local.close();
}
