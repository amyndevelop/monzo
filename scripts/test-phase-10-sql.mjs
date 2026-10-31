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
const upgrade = readFileSync('docs/sql/phase-10-upgrade.sql', 'utf8');
function rejected(sql, pattern, database) {
  assert.throws(
    () => query(sql, database),
    (error) => pattern.test(String(error.stderr)),
  );
}
const table = () =>
  query(
    `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='AutomationVariable';`,
  );
const history = () =>
  query('SELECT row_to_json(t)::text FROM public._prisma_migrations t ORDER BY migration_name;');
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
  for (const phase of [2, 3, 4, 5, 6, 7])
    query(
      readFileSync(`docs/sql/phase-${phase}-${phase === 2 ? 'bootstrap' : 'upgrade'}.sql`, 'utf8'),
    );
  query(`INSERT INTO "User"(id,email,"updatedAt") VALUES ('v-user','vars@example.test',now());
 INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES ('v-tenant','Variables','var-test',now());
 INSERT INTO "WhatsappAccount"(id,"tenantId","phoneNumberId","businessAccountId","displayPhone","displayName","updatedAt") VALUES ('v-account','v-tenant','100001','200001','Prueba','Prueba',now());
 INSERT INTO "Contact"(id,"tenantId","accountId","waId","updatedAt") VALUES ('v-contact','v-tenant','v-account','155500001',now());
 INSERT INTO "Conversation"(id,"tenantId","accountId","contactId","automationState","updatedAt") VALUES ('v-chat','v-tenant','v-account','v-contact','{"variables":{"nombre":"Ana"}}',now());
 INSERT INTO "Message"(id,"tenantId","accountId","conversationId",direction,status,type,text,"occurredAt","updatedAt") VALUES ('v-message','v-tenant','v-account','v-chat','INBOUND','RECEIVED','text','Conservar',now(),now());
 INSERT INTO "AutomationFlow"(id,"tenantId","accountId",draft,published,"updatedAt") VALUES ('v-flow','v-tenant','v-account','{"name":"Anterior","start":"captura","nodes":[{"id":"captura","label":"Nombre","kind":"capture","text":"Nombre?","variable":"nombre","options":[]}]}','{"nodes":[{"kind":"capture","variable":"nombre"}]}',now());`);
  const previous = history(),
    graph = query(
      `SELECT draft::text||'|'||published::text FROM "AutomationFlow" WHERE id='v-flow';`,
    ),
    state = query(`SELECT "automationState"::text FROM "Conversation" WHERE id='v-chat';`);
  query(
    `CREATE FUNCTION reject_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated history failure'; END $$; CREATE TRIGGER reject_history BEFORE INSERT ON _prisma_migrations FOR EACH ROW EXECUTE FUNCTION reject_history();`,
  );
  rejected(upgrade, /simulated history failure/);
  assert.equal(table(), '0');
  assert.equal(history(), previous);
  query('DROP TRIGGER reject_history ON _prisma_migrations; DROP FUNCTION reject_history();');
  query('CREATE TABLE "AutomationVariable"(id text);');
  rejected(upgrade, /esquema sin historial/);
  query('DROP TABLE "AutomationVariable";');
  query(
    `UPDATE _prisma_migrations SET checksum=repeat('0',64) WHERE migration_name='202610300004_guided_flows';`,
  );
  rejected(upgrade, /historial incompatible/);
  const checksum = createHash('sha256')
    .update(readFileSync('prisma/migrations/202610300004_guided_flows/migration.sql'))
    .digest('hex');
  query(
    `UPDATE _prisma_migrations SET checksum='${checksum}' WHERE migration_name='202610300004_guided_flows';`,
  );
  assert.equal(query(upgrade), 'neondb|1|12|9');
  assert.equal(table(), '1');
  assert.equal(
    query(
      `SELECT identifier||'|'||type||'|'||scope FROM "AutomationVariable" WHERE "tenantId"='v-tenant';`,
    ),
    'nombre|text|execution',
  );
  assert.equal(
    query(`SELECT draft::text||'|'||published::text FROM "AutomationFlow" WHERE id='v-flow';`),
    graph,
  );
  assert.equal(
    query(`SELECT "automationState"::text FROM "Conversation" WHERE id='v-chat';`),
    state,
  );
  assert.equal(query(`SELECT text FROM "Message" WHERE id='v-message';`), 'Conservar');
  const after = history();
  query(`UPDATE "AutomationVariable" SET name='Nombre cambiado' WHERE identifier='nombre';`);
  assert.equal(query(upgrade), 'neondb|1|12|9');
  assert.equal(history(), after);
  assert.equal(
    query(`SELECT name FROM "AutomationVariable" WHERE identifier='nombre';`),
    'Nombre cambiado',
  );
  rejected(
    `INSERT INTO "AutomationVariable" SELECT 'duplicate',"tenantId",name,identifier,type,description,"defaultValue",scope,currency,revision,"createdAt","updatedAt" FROM "AutomationVariable" LIMIT 1;`,
    /unique constraint/,
  );
  rejected(
    `INSERT INTO "AutomationVariable"(id,"tenantId",name,identifier,type,"updatedAt") VALUES ('foreign','absent','Foreign','valid','text',now());`,
    /foreign key/,
  );
  rejected(`UPDATE "AutomationVariable" SET scope='contact';`, /check constraint/);
  query(`ALTER TABLE "AutomationVariable" ALTER COLUMN scope SET DEFAULT 'contact';`);
  rejected(upgrade, /alcance inicial incompatible/);
  console.log(
    'Phase 10 SQL passed: rollback, exact ledger, legacy import, isolation, safe repeat and preservation.',
  );
} finally {
  if (created) query('DROP DATABASE neondb WITH (FORCE);', 'postgres');
}
