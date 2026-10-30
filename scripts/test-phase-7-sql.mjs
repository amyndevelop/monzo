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
const upgrade = readFileSync('docs/sql/phase-7-upgrade.sql', 'utf8');
const history = () =>
  query('SELECT row_to_json(t)::text FROM public._prisma_migrations t ORDER BY migration_name;');
function rejected(sql, pattern, database) {
  assert.throws(
    () => query(sql, database),
    (error) => pattern.test(String(error.stderr)),
  );
}
const table = () =>
  query(
    `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='AutomationFlow';`,
  );
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
  for (const phase of [2, 3, 4, 5, 6])
    query(
      readFileSync(`docs/sql/phase-${phase}-${phase === 2 ? 'bootstrap' : 'upgrade'}.sql`, 'utf8'),
    );
  query(`INSERT INTO public."User" (id,email,"updatedAt") VALUES ('media-user','media-migration@example.test',now());
 INSERT INTO public."Tenant" (id,name,slug,"updatedAt") VALUES ('media-tenant','Prueba local','media-migration',now());
 INSERT INTO public."Membership" (id,"userId","tenantId",role,"updatedAt") VALUES ('media-member','media-user','media-tenant','OWNER',now());
 INSERT INTO public."WhatsappAccount" (id,"tenantId","phoneNumberId","businessAccountId","displayPhone","displayName","updatedAt") VALUES ('media-account','media-tenant','1234567890','2345678901','Prueba','Prueba',now());
 INSERT INTO public."Contact" (id,"tenantId","accountId","waId","updatedAt") VALUES ('media-contact','media-tenant','media-account','5491112345678',now());
 INSERT INTO public."Conversation" (id,"tenantId","accountId","contactId","updatedAt") VALUES ('media-chat','media-tenant','media-account','media-contact',now());
 INSERT INTO public."Message" (id,"tenantId","accountId","conversationId",direction,status,type,text,"occurredAt","updatedAt") VALUES ('media-message','media-tenant','media-account','media-chat','INBOUND','RECEIVED','text','Conservar este mensaje',now(),now());`);

  const previous = history();
  query(
    `CREATE FUNCTION public.reject_template_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated history failure'; END $$; CREATE TRIGGER reject_template_history BEFORE INSERT ON public._prisma_migrations FOR EACH ROW EXECUTE FUNCTION public.reject_template_history();`,
  );
  rejected(upgrade, /simulated history failure/);
  assert.equal(table(), '0');
  assert.equal(history(), previous);
  query(
    'DROP TRIGGER reject_template_history ON public._prisma_migrations; DROP FUNCTION public.reject_template_history();',
  );
  query('CREATE TABLE public."AutomationFlow" (id TEXT);');
  rejected(upgrade, /esquema sin historial/);
  query('DROP TABLE public."AutomationFlow";');
  query(
    `UPDATE public._prisma_migrations SET checksum=repeat('0',64) WHERE migration_name='202610300001_whatsapp_media';`,
  );
  rejected(upgrade, /historial incompatible/);
  const previousChecksum = createHash('sha256')
    .update(readFileSync('prisma/migrations/202610300001_whatsapp_media/migration.sql'))
    .digest('hex');
  query(
    `UPDATE public._prisma_migrations SET checksum='${previousChecksum}' WHERE migration_name='202610300001_whatsapp_media';`,
  );
  assert.equal(query(upgrade), 'neondb|1|3|4|8');
  assert.equal(table(), '1');
  assert.equal(
    query(`SELECT text FROM public."Message" WHERE id='media-message';`),
    'Conservar este mensaje',
  );
  assert.equal(query(`SELECT count(*) FROM public."User" WHERE id='media-user';`), '1');
  const after = history();
  assert.equal(query(upgrade), 'neondb|1|3|4|8');
  assert.equal(history(), after);
  const checksum = createHash('sha256')
    .update(readFileSync('prisma/migrations/202610300004_guided_flows/migration.sql'))
    .digest('hex');
  assert.equal(
    query(
      `SELECT checksum FROM public._prisma_migrations WHERE migration_name='202610300004_guided_flows';`,
    ),
    checksum,
  );
  assert.equal(
    query(`SELECT "automationPaused"::text FROM public."Conversation" WHERE id='media-chat';`),
    'true',
  );
  query(
    `INSERT INTO public."AutomationFlow" (id,"tenantId","accountId",draft,"updatedAt") VALUES ('flow','media-tenant','media-account','{}',now());`,
  );
  assert.equal(
    query(
      `SELECT enabled::text || '|' || "publishedVersion"::text FROM public."AutomationFlow" WHERE id='flow';`,
    ),
    'false|0',
  );
  query(`UPDATE public."Conversation" SET "automationPaused"=false WHERE id='media-chat';`);
  assert.equal(query(upgrade), 'neondb|1|3|4|8');
  assert.equal(
    query(`SELECT "automationPaused"::text FROM public."Conversation" WHERE id='media-chat';`),
    'false',
  );
  rejected(
    `INSERT INTO public."AutomationFlow" (id,"tenantId","accountId",draft,"updatedAt") VALUES ('duplicate','media-tenant','media-account','{}',now());`,
    /unique constraint/,
  );
  rejected(
    `INSERT INTO public."AutomationFlow" (id,"tenantId","accountId",draft,"updatedAt") VALUES ('foreign','missing','missing','{}',now());`,
    /foreign key constraint/,
  );
  query(
    `INSERT INTO public."WhatsappAccount" (id,"tenantId","phoneNumberId","businessAccountId","displayPhone","displayName","updatedAt") VALUES ('other-account','media-tenant','1234567899','2345678901','Other','Other',now()); INSERT INTO public."AutomationFlow" (id,"tenantId","accountId",draft,"updatedAt") VALUES ('other-flow','media-tenant','other-account','{}',now());`,
  );
  rejected(
    `UPDATE public."Message" SET "automationFlowId"='other-flow' WHERE id='media-message';`,
    /foreign key constraint/,
  );
  query('ALTER TABLE public."AutomationFlow" ALTER COLUMN "draft" TYPE text USING "draft"::text;');
  rejected(upgrade, /tipo no coincide/);
  console.log(
    'Phase 7 SQL passed: prior data/history preserved, atomic rollback, correct checksums, safe rerun, tenant references and invalid schemas refused. Local scratch database only.',
  );
} finally {
  if (created) query('DROP DATABASE neondb;', 'postgres');
}
