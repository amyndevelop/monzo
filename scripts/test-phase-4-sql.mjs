import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
    env,
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}
const container = docker(['compose', 'ps', '--quiet', 'test-database']);
assert.match(container, /^[a-f0-9]{12,64}$/);
const [info] = JSON.parse(docker(['inspect', container]));
assert.equal(info.Config.Labels['com.docker.compose.service'], 'test-database');
assert.ok(info.Config.Env.includes('POSTGRES_DB=monzo_test'));
assert.deepEqual(info.HostConfig.PortBindings['5432/tcp'], [
  { HostIp: '127.0.0.1', HostPort: '55433' },
]);
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
const upgrade = readFileSync('docs/sql/phase-4-upgrade.sql', 'utf8');
const columns = () =>
  Number(
    query(
      `SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Message' AND column_name IN ('mediaMimeType','mediaFilename','mediaSize','mediaSha256');`,
    ),
  );
const history = () =>
  query('SELECT row_to_json(t)::text FROM public._prisma_migrations t ORDER BY migration_name;');
function rejected(sql, pattern, database) {
  assert.throws(
    () => query(sql, database),
    (error) => pattern.test(String(error.stderr)),
  );
}
const migration = readFileSync('prisma/migrations/202610300001_whatsapp_media/migration.sql');
const checksum = createHash('sha256').update(migration).digest('hex');
let created = false;
try {
  assert.equal(
    query("SELECT count(*) FROM pg_database WHERE datname='neondb';", 'postgres'),
    '0',
    'Scratch database exists; leave it untouched.',
  );
  query('CREATE DATABASE neondb;', 'postgres');
  created = true;
  rejected(upgrade, /elegi la base neondb/, 'postgres');
  rejected(upgrade, /falta el esquema/);
  query(readFileSync('docs/sql/phase-2-bootstrap.sql', 'utf8'));
  query(readFileSync('docs/sql/phase-3-upgrade.sql', 'utf8'));
  query(`INSERT INTO public."User" (id,email,"updatedAt") VALUES ('media-user','media-migration@example.test',now());
 INSERT INTO public."Tenant" (id,name,slug,"updatedAt") VALUES ('media-tenant','Prueba local','media-migration',now());
 INSERT INTO public."Membership" (id,"userId","tenantId",role,"updatedAt") VALUES ('media-member','media-user','media-tenant','OWNER',now());
 INSERT INTO public."WhatsappAccount" (id,"tenantId","phoneNumberId","businessAccountId","displayPhone","displayName","updatedAt") VALUES ('media-account','media-tenant','1234567890','2345678901','Prueba','Prueba',now());
 INSERT INTO public."Contact" (id,"tenantId","accountId","waId","updatedAt") VALUES ('media-contact','media-tenant','media-account','5491112345678',now());
 INSERT INTO public."Conversation" (id,"tenantId","accountId","contactId","updatedAt") VALUES ('media-chat','media-tenant','media-account','media-contact',now());
 INSERT INTO public."Message" (id,"tenantId","accountId","conversationId",direction,status,type,text,"occurredAt","updatedAt") VALUES ('media-message','media-tenant','media-account','media-chat','INBOUND','RECEIVED','text','Conservar este mensaje',now(),now());`);
  const previous = history();
  query(
    `CREATE FUNCTION public.reject_media_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated history failure'; END $$; CREATE TRIGGER reject_media_history BEFORE INSERT ON public._prisma_migrations FOR EACH ROW EXECUTE FUNCTION public.reject_media_history();`,
  );
  rejected(upgrade, /simulated history failure/);
  assert.equal(columns(), 0);
  assert.equal(history(), previous);
  query(
    'DROP TRIGGER reject_media_history ON public._prisma_migrations; DROP FUNCTION public.reject_media_history();',
  );
  query(`ALTER TABLE public."Message" ADD COLUMN "mediaSize" INTEGER;`);
  rejected(upgrade, /columnas sin historial/);
  assert.equal(columns(), 1);
  query(`ALTER TABLE public."Message" DROP COLUMN "mediaSize";`);
  query(
    `UPDATE public._prisma_migrations SET checksum=repeat('0',64) WHERE migration_name='202610290004_event_dispatch';`,
  );
  rejected(upgrade, /historial incompatible/);
  const old = createHash('sha256')
    .update(readFileSync('prisma/migrations/202610290004_event_dispatch/migration.sql'))
    .digest('hex');
  query(
    `UPDATE public._prisma_migrations SET checksum='${old}' WHERE migration_name='202610290004_event_dispatch';`,
  );
  query(
    `INSERT INTO public._prisma_migrations (id,checksum,finished_at,migration_name,applied_steps_count) SELECT 'duplicate-history',checksum,finished_at,migration_name,applied_steps_count FROM public._prisma_migrations LIMIT 1;`,
  );
  rejected(upgrade, /historial duplicado/);
  query("DELETE FROM public._prisma_migrations WHERE id='duplicate-history';");
  assert.equal(query(upgrade), 'neondb|4|5');
  assert.equal(columns(), 4);
  assert.equal(
    query(`SELECT text FROM public."Message" WHERE id='media-message';`),
    'Conservar este mensaje',
  );
  assert.equal(query(`SELECT count(*) FROM public."User" WHERE id='media-user';`), '1');
  assert.equal(
    query(
      `SELECT checksum FROM public._prisma_migrations WHERE migration_name='202610300001_whatsapp_media';`,
    ),
    checksum,
  );
  const after = history();
  assert.equal(query(upgrade), 'neondb|4|5');
  assert.equal(history(), after);
  query(`ALTER TABLE public."Message" ALTER COLUMN "mediaSize" TYPE text;`);
  rejected(upgrade, /tipo no coincide/);
  console.log(
    'Phase 4 SQL passed: data preserved, exact checksums, atomic rollback, incorrect target/history/schema refused and safe rerun. Isolated local scratch database only.',
  );
} finally {
  if (created) query('DROP DATABASE neondb;', 'postgres');
}
