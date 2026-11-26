import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import {
  baselineMigrations,
  baselineSql,
  fingerprintSql,
  migrationTableSql,
} from './evolution-preview-baseline.mjs';
import { evolutionMigration, evolutionUpgradeSql } from './evolution-preview-upgrade.mjs';

// Test-only image. This never changes the Compose image, network or existing databases.
const image = 'postgres@sha256:0115267ab5a509022df9319c77be365cef335adb71556c75f60f5360ee247e71';
const env = { ...process.env };
for (const key of [
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_TLS',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
])
  delete env[key];
const docker = (args, input) =>
  execFileSync('docker', ['--host=unix:///var/run/docker.sock', ...args], {
    env,
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
let container;
try {
  const name = 'monzo-preview-pg18-' + randomBytes(6).toString('hex');
  container = docker([
    'run',
    '--detach',
    '--name',
    name,
    '--network',
    'none',
    '--memory',
    '512m',
    '--pids-limit',
    '128',
    '--user',
    'postgres',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--tmpfs',
    '/var/lib/postgresql:rw,mode=1777,size=256m',
    '--tmpfs',
    '/var/run/postgresql:rw,mode=1777,size=16m',
    '-e',
    'POSTGRES_USER=monzo',
    '-e',
    'POSTGRES_DB=neondb',
    '-e',
    'POSTGRES_HOST_AUTH_METHOD=trust',
    image,
  ]);
  assert.match(container, /^[a-f0-9]{64}$/);
  const [info] = JSON.parse(docker(['inspect', container]));
  assert.equal(info.Name, '/' + name);
  assert.equal(info.HostConfig.NetworkMode, 'none');
  assert.equal(info.HostConfig.PublishAllPorts, false);
  assert.ok(
    !info.HostConfig.PortBindings || Object.keys(info.HostConfig.PortBindings).length === 0,
  );
  assert.equal(
    info.Mounts.some((m) => m.Type === 'volume' || m.Type === 'bind'),
    false,
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      // The image's init server exposes only its Unix socket and is stopped
      // before the final server starts. TCP readiness excludes that brief phase.
      docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'monzo', '-d', 'neondb']);
      ready = true;
      break;
    } catch {}
    await delay(200);
  }
  assert.ok(ready, 'PostgreSQL 18 test container did not become ready');
  const query = (sql) =>
    docker(
      [
        'exec',
        '-i',
        container,
        'psql',
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        '-qAt',
        '-U',
        'monzo',
        '-d',
        'neondb',
      ],
      sql,
    );
  assert.match(query('SHOW server_version;'), /^18\./);
  const migrations = baselineMigrations();
  query(migrationTableSql + migrations.map((m) => m.sql).join('\n'));
  const artifact = readFileSync('docs/sql/evolution-preview-baseline.sql', 'utf8');
  const expected = JSON.parse(
    artifact.match(/actual_fingerprint IS DISTINCT FROM '([^']+)'::jsonb/)[1],
  );
  assert.deepEqual(
    JSON.parse(query('SET search_path=public,pg_catalog;' + fingerprintSql + ';')),
    expected,
  );
  const notNulls = Number(
    query(
      "SELECT count(*) FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace WHERE n.nspname='public' AND k.contype='n';",
    ),
  );
  assert.ok(notNulls > 0);
  const rejected = (sql, pattern) =>
    assert.throws(
      () => query(sql),
      (e) => pattern.test(String(e.stderr)),
    );
  rejected(
    'BEGIN; ALTER TABLE "User" ALTER COLUMN email DROP NOT NULL;' + artifact + 'COMMIT;',
    /estructura incompatible \(columns\)/,
  );
  rejected(
    'BEGIN; ALTER TABLE "WhatsappAccount" DROP CONSTRAINT "WhatsappAccount_provider_check";' +
      artifact +
      'COMMIT;',
    /estructura incompatible \(constraints\)/,
  );
  rejected(
    'BEGIN; ALTER TABLE "User" ADD CONSTRAINT baseline_nn_name NOT NULL name NOT VALID;' +
      artifact +
      'COMMIT;',
    /NOT NULL sin validar o incompatibles/,
  );
  assert.equal(query('SELECT count(*) FROM _prisma_migrations;'), '0');
  assert.equal(query(artifact), 'neondb|11|0|0|0');
  const history = query('SELECT row_to_json(h) FROM _prisma_migrations h ORDER BY migration_name;');
  assert.equal(query(artifact), 'neondb|11|0|0|0');
  assert.equal(
    query('SELECT row_to_json(h) FROM _prisma_migrations h ORDER BY migration_name;'),
    history,
  );
  assert.equal(artifact, baselineSql(migrations, expected));
  const upgrade = readFileSync('docs/sql/evolution-preview-upgrade.sql', 'utf8');
  // Preview now contains a newly registered user and company: the upgrade must
  // preserve both, and must keep PostgreSQL 18's extra NOT NULL catalog entries.
  query(`INSERT INTO "User"(id,email,"emailVerified","updatedAt") VALUES ('pg18-user','pg18@example.invalid',true,now());
    INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES ('pg18-tenant','Prueba','pg18-tenant',now());`);
  const accounts = query(
    'SELECT row_to_json(t) FROM "User" t; SELECT row_to_json(t) FROM "Tenant" t;',
  );
  const rollback = upgrade.replace(
    ' INSERT INTO public._prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count)',
    " RAISE EXCEPTION 'forced-pg18-upgrade-rollback'; INSERT INTO public._prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count)",
  );
  assert.notEqual(rollback, upgrade);
  rejected(rollback, /forced-pg18-upgrade-rollback/);
  assert.equal(query('SELECT count(*) FROM _prisma_migrations;'), '11');
  assert.deepEqual(JSON.parse(query(fingerprintSql + ';')), expected);
  assert.equal(query(upgrade), 'neondb|12|1|1|1|1|1');
  const upgradedFingerprint = JSON.parse(query(fingerprintSql + ';'));
  assert.equal(upgrade, evolutionUpgradeSql(migrations, expected, upgradedFingerprint));
  assert.equal(
    query(
      `SELECT checksum FROM _prisma_migrations WHERE migration_name='${evolutionMigration().name}';`,
    ),
    evolutionMigration().checksum,
  );
  const upgradedHistory = query(
    'SELECT row_to_json(h) FROM _prisma_migrations h ORDER BY migration_name;',
  );
  assert.equal(query(upgrade), 'neondb|12|1|1|1|1|1');
  assert.equal(
    query('SELECT row_to_json(h) FROM _prisma_migrations h ORDER BY migration_name;'),
    upgradedHistory,
  );
  assert.equal(
    query('SELECT row_to_json(t) FROM "User" t; SELECT row_to_json(t) FROM "Tenant" t;'),
    accounts,
  );
  console.log(
    `PostgreSQL 18 real comprobado: ${notNulls} NOT NULL iniciales, baseline y upgrade Evolution compatibles, doce checksums, rollback, idempotencia y cuentas preservadas. Contenedor temporal sin red ni volumen persistente.`,
  );
} finally {
  if (container) docker(['rm', '--force', container]);
}
