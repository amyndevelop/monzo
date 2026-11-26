import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  baselineMigrations,
  baselineSql,
  fingerprintSql,
  migrationTableSql,
} from './evolution-preview-baseline.mjs';
import { localPreviewPostgres } from './evolution-preview-local-postgres.mjs';

const migrations = baselineMigrations();
const local = localPreviewPostgres();
const legacy = localPreviewPostgres();
const fingerprint = (db) =>
  JSON.parse(db.query('SET search_path=public,pg_catalog;\n' + fingerprintSql + ';'));
const rejected = (sql, pattern) =>
  assert.throws(
    () => local.query(sql),
    (error) => pattern.test(String(error.stderr)),
  );
try {
  local.create();
  local.query(migrationTableSql + migrations.map((m) => m.sql).join('\n'));
  const expected = fingerprint(local);
  const sql = baselineSql(migrations, expected, local.database);
  const artifact = baselineSql(migrations, expected);
  assert.equal(readFileSync('docs/sql/evolution-preview-baseline.sql', 'utf8'), artifact);
  const count = () => local.query('SELECT count(*) FROM _prisma_migrations;');
  const ledger = () =>
    local.query('SELECT row_to_json(h) FROM _prisma_migrations h ORDER BY migration_name;');

  rejected(artifact, /selecciona neondb/);
  assert.equal(count(), '0');
  for (const ddl of [
    'ALTER TABLE "WhatsappAccount" ALTER COLUMN provider SET DEFAULT \'BAILEYS\';',
    'ALTER TABLE "WhatsappAccount" DROP CONSTRAINT "WhatsappAccount_provider_check";',
    'ALTER TABLE "User" ALTER COLUMN email DROP NOT NULL;',
    'CREATE INDEX baseline_unexpected_index ON "User"(name);',
    'ALTER TYPE "MembershipRole" ADD VALUE \'UNEXPECTED\';',
  ]) {
    rejected('BEGIN;' + ddl + sql + 'COMMIT;', /estructura incompatible/);
    assert.equal(count(), '0');
    assert.deepEqual(fingerprint(local), expected);
  }

  local.query(
    `INSERT INTO "RateLimit"(id,key,count,"lastRequest") VALUES ('baseline-fixture','baseline-fixture',1,0);`,
  );
  rejected(sql, /contiene datos/);
  assert.equal(count(), '0');
  assert.equal(local.query('SELECT count(*) FROM "RateLimit";'), '1');
  local.query('DELETE FROM "RateLimit";');

  local.query(
    `INSERT INTO _prisma_migrations(id,checksum,migration_name,finished_at) VALUES ('baseline-fixture','${migrations[0].checksum}','${migrations[0].name}',now());`,
  );
  const partial = ledger();
  rejected(sql, /historial parcial o incompatible/);
  assert.equal(ledger(), partial);
  local.query('DELETE FROM _prisma_migrations;');

  const failAfterInsert = sql.replace(
    "RAISE NOTICE 'MONZO: historial de once",
    "RAISE EXCEPTION 'forced-baseline-rollback'; RAISE NOTICE 'MONZO: historial de once",
  );
  assert.notEqual(failAfterInsert, sql);
  rejected(failAfterInsert, /forced-baseline-rollback/);
  assert.equal(count(), '0');
  assert.deepEqual(fingerprint(local), expected);

  assert.equal(local.query(sql), local.database + '|11|0|0|0');
  const complete = ledger();
  assert.equal(local.query(sql), local.database + '|11|0|0|0');
  assert.equal(ledger(), complete);
  for (const migration of migrations)
    assert.equal(
      local.query(
        `SELECT checksum FROM _prisma_migrations WHERE migration_name='${migration.name}';`,
      ),
      migration.checksum,
    );
  local.query(
    `INSERT INTO "RateLimit"(id,key,count,"lastRequest") VALUES ('baseline-repeat','baseline-repeat',1,0);`,
  );
  assert.equal(local.query(sql), local.database + '|11|0|0|0');
  assert.equal(ledger(), complete);
  assert.equal(local.query('SELECT count(*) FROM "RateLimit";'), '1');
  local.query(
    `UPDATE _prisma_migrations SET checksum=repeat('0',64) WHERE migration_name='${migrations[0].name}';`,
  );
  const corrupted = ledger();
  rejected(sql, /historial parcial o incompatible/);
  assert.equal(ledger(), corrupted);

  // Also match the SQL-editor installation path used by this user's production parent.
  legacy.create();
  for (const phase of [2, 3, 4, 5, 6, 7, 10, 11, 12]) {
    const name = `docs/sql/phase-${phase}-${phase === 2 ? 'bootstrap' : 'upgrade'}.sql`;
    legacy.query(readFileSync(name, 'utf8').replaceAll("'neondb'", `'${legacy.database}'`));
  }
  assert.deepEqual(fingerprint(legacy), expected);
  legacy.query('TRUNCATE public._prisma_migrations;');
  assert.equal(
    legacy.query(baselineSql(migrations, expected, legacy.database)),
    legacy.database + '|11|0|0|0',
  );
  console.log(
    'Preview baseline comprobado: esquema de migraciones y SQL Editor equivalentes, rechazo de deriva/datos/historial incorrecto, rollback atomico, once checksums exactos y repeticion sin cambios. Solo bases temporales locales.',
  );
} finally {
  legacy.close();
  local.close();
}
