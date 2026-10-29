import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env };
for (const key of [
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_TLS',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
])
  delete env[key];
function docker(args, input) {
  return execFileSync('docker', ['--host=unix:///var/run/docker.sock', ...args], {
    cwd: root,
    env,
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}
const container = docker(['compose', 'ps', '--quiet', 'test-database']);
assert.match(container, /^[a-f0-9]{12,64}$/, 'Expected one local test container.');
const [info] = JSON.parse(docker(['inspect', container]));
assert.equal(info.Config.Labels['com.docker.compose.service'], 'test-database');
assert.ok(info.Config.Env.includes('POSTGRES_DB=monzo_test'));
assert.deepEqual(info.HostConfig.PortBindings['5432/tcp'], [
  { HostIp: '127.0.0.1', HostPort: '55433' },
]);
const filename = process.argv.includes('--compact')
  ? 'phase-3-upgrade-compact.sql'
  : 'phase-3-upgrade.sql';
const upgrade = readFileSync(new URL(`../docs/sql/${filename}`, import.meta.url), 'utf8');
function query(sql, database = 'neondb') {
  return docker(
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
      database,
    ],
    sql,
  );
}
function rejected(sql, message, database) {
  assert.throws(
    () => query(sql, database),
    (error) => message.test(String(error.stderr)),
  );
}
const tableCount = () =>
  Number(
    query(
      "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';",
    ),
  );
const historyCount = () => Number(query('SELECT count(*) FROM public._prisma_migrations;'));
const snapshot = () =>
  query(`SELECT json_build_object(
  'users', (SELECT json_agg(t) FROM public."User" t),
  'tenants', (SELECT json_agg(t) FROM public."Tenant" t),
  'memberships', (SELECT json_agg(t) FROM public."Membership" t))::text;`);
let created = false;
try {
  assert.equal(
    query("SELECT count(*) FROM pg_database WHERE datname='neondb';", 'postgres'),
    '0',
    'Scratch database already exists; leave it untouched.',
  );
  query('CREATE DATABASE neondb;', 'postgres');
  created = true;
  rejected(upgrade, /elegi la base neondb/, 'postgres');
  rejected(upgrade, /falta el historial/);
  assert.equal(tableCount(), 0);
  query(readFileSync(new URL('../docs/sql/phase-2-bootstrap.sql', import.meta.url), 'utf8'));
  query(`INSERT INTO public."User" (id,email,name,"updatedAt") VALUES ('release-test-user','release-check@example.test','Prueba local de migracion',now());
    INSERT INTO public."Tenant" (id,name,slug,"updatedAt") VALUES ('release-test-tenant','Empresa de prueba de migracion','release-check',now());
    INSERT INTO public."Membership" (id,"userId","tenantId",role,"updatedAt") VALUES ('release-test-member','release-test-user','release-test-tenant','OWNER',now());`);
  assert.equal(tableCount(), 10);
  const original = snapshot();
  // A conflict after the first CREATE TYPE must roll back the entire DO statement.
  query(`CREATE TYPE public."MessageStatus" AS ENUM ('EXISTING_TEST_TYPE');`);
  rejected(upgrade, /already exists/);
  assert.equal(
    query(
      `SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='MessageDirection';`,
    ),
    '0',
  );
  assert.equal(tableCount(), 10);
  assert.equal(historyCount(), 2);
  assert.equal(snapshot(), original);
  query('DROP TYPE public."MessageStatus";');
  // A modified baseline must be refused without registering new migrations.
  query(
    `UPDATE public._prisma_migrations SET checksum=repeat('0',64) WHERE migration_name='202610290002_auth_tenants';`,
  );
  rejected(upgrade, /historial incompatible/);
  assert.equal(historyCount(), 2);
  const baseline = readFileSync(
    new URL('../prisma/migrations/202610290002_auth_tenants/migration.sql', import.meta.url),
  );
  const checksum = createHash('sha256').update(baseline).digest('hex');
  query(
    `UPDATE public._prisma_migrations SET checksum='${checksum}' WHERE migration_name='202610290002_auth_tenants';`,
  );
  const result = query(upgrade);
  if (process.argv.includes('--compact')) assert.equal(result, 'neondb|7|4|2');
  assert.equal(tableCount(), 17);
  assert.equal(historyCount(), 4);
  assert.equal(snapshot(), original);
  assert.equal(
    query(
      `SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('Message','WhatsappWebhookEvent') AND column_name='jobPublishedAt';`,
    ),
    '2',
  );
  for (const name of ['202610290003_whatsapp_inbox', '202610290004_event_dispatch']) {
    const bytes = readFileSync(
      new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
    );
    assert.equal(
      query(`SELECT checksum FROM public._prisma_migrations WHERE migration_name='${name}';`),
      createHash('sha256').update(bytes).digest('hex'),
    );
  }
  const history = query(
    'SELECT row_to_json(t)::text FROM public._prisma_migrations t ORDER BY migration_name;',
  );
  query(upgrade);
  assert.equal(snapshot(), original);
  assert.equal(
    query('SELECT row_to_json(t)::text FROM public._prisma_migrations t ORDER BY migration_name;'),
    history,
  );
  query(`INSERT INTO public._prisma_migrations (id,checksum,finished_at,migration_name,applied_steps_count)
    SELECT 'release-duplicate-history',checksum,finished_at,migration_name,applied_steps_count
    FROM public._prisma_migrations WHERE migration_name='202610290001_foundation';`);
  rejected(upgrade, /historial duplicado/);
  assert.equal(historyCount(), 5);
  query("DELETE FROM public._prisma_migrations WHERE id='release-duplicate-history';");
  query(
    `DELETE FROM public._prisma_migrations WHERE migration_name='202610290004_event_dispatch';`,
  );
  rejected(upgrade, /historial parcial/);
  assert.equal(tableCount(), 17);
  assert.equal(historyCount(), 3);
  console.log(
    'Release SQL passed: correct upgrade, user/company preservation, atomic rollback, wrong target/baseline refusal, exact checksums, safe rerun and partial-history refusal. Local scratch database only.',
  );
} finally {
  if (created) query('DROP DATABASE neondb;', 'postgres');
}
