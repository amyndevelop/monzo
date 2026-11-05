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
const upgrade = readFileSync('docs/sql/phase-11-upgrade.sql', 'utf8');
const history = () =>
  query('SELECT row_to_json(t)::text FROM public._prisma_migrations t ORDER BY migration_name;');
function rejected(sql, pattern, database) {
  assert.throws(
    () => query(sql, database),
    (e) => pattern.test(String(e.stderr)),
  );
}
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
  for (const phase of [2, 3, 4, 5, 6, 7, 10])
    query(
      readFileSync(`docs/sql/phase-${phase}-${phase === 2 ? 'bootstrap' : 'upgrade'}.sql`, 'utf8'),
    );
  query(`INSERT INTO "User"(id,email,"updatedAt") VALUES ('crm-user','crm@example.test',now());
 INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES ('crm-tenant','CRM','crm-test',now());
 INSERT INTO "WhatsappAccount"(id,"tenantId","phoneNumberId","businessAccountId","displayPhone","displayName","updatedAt") VALUES ('crm-account','crm-tenant','100001','200001','Prueba','Prueba',now());
 INSERT INTO "Contact"(id,"tenantId","accountId","waId",name,"updatedAt") VALUES ('crm-contact','crm-tenant','crm-account','155500001','Nombre original',now());
 INSERT INTO "Conversation"(id,"tenantId","accountId","contactId","automationState","updatedAt") VALUES ('crm-chat','crm-tenant','crm-account','crm-contact','{"variables":{"nombre":"Ana"}}',now());
 INSERT INTO "Message"(id,"tenantId","accountId","conversationId",direction,status,type,text,"occurredAt","updatedAt") VALUES ('crm-message','crm-tenant','crm-account','crm-chat','INBOUND','RECEIVED','text','Conservar',now(),now());`);
  const previous = history();
  const snapshot = () =>
    query(`SELECT row_to_json(c)::text FROM "Conversation" c WHERE id='crm-chat';`);
  const state = snapshot();
  query(
    `CREATE FUNCTION reject_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated history failure'; END $$; CREATE TRIGGER reject_history BEFORE INSERT ON _prisma_migrations FOR EACH ROW EXECUTE FUNCTION reject_history();`,
  );
  rejected(upgrade, /simulated history failure/);
  assert.equal(
    query(
      `SELECT count(*) FROM information_schema.columns WHERE table_name='Contact' AND column_name='salesStage';`,
    ),
    '0',
  );
  assert.equal(history(), previous);
  query('DROP TRIGGER reject_history ON _prisma_migrations; DROP FUNCTION reject_history();');
  query(`ALTER TABLE "Contact" ADD COLUMN "crmName" text;`);
  rejected(upgrade, /campos comerciales sin historial/);
  query(`ALTER TABLE "Contact" DROP COLUMN "crmName";`);
  query(
    `UPDATE _prisma_migrations SET checksum=repeat('0',64) WHERE migration_name='202610310001_dynamic_variables';`,
  );
  rejected(upgrade, /historial incompatible/);
  const checksum = createHash('sha256')
    .update(readFileSync('prisma/migrations/202610310001_dynamic_variables/migration.sql'))
    .digest('hex');
  query(
    `UPDATE _prisma_migrations SET checksum='${checksum}' WHERE migration_name='202610310001_dynamic_variables';`,
  );
  assert.equal(query(upgrade), 'neondb|8|10');
  assert.equal(snapshot(), state);
  assert.equal(
    query(
      `SELECT name||'|'||"salesStage"||'|'||"crmRevision"||'|'||cardinality(tags) FROM "Contact" WHERE id='crm-contact';`,
    ),
    'Nombre original|NEW|1|0',
  );
  assert.equal(query(`SELECT text FROM "Message" WHERE id='crm-message';`), 'Conservar');
  const after = history();
  query(
    `UPDATE "Contact" SET "crmName"='Nombre editado',"salesStage"='FOLLOW_UP',tags=ARRAY['Cliente'],"ownerUserId"='crm-user',"crmRevision"=2;`,
  );
  assert.equal(query(upgrade), 'neondb|8|10');
  assert.equal(history(), after);
  assert.equal(
    query(
      `SELECT "crmName"||'|'||"salesStage"||'|'||"crmRevision"||'|'||tags[1] FROM "Contact" WHERE id='crm-contact';`,
    ),
    'Nombre editado|FOLLOW_UP|2|Cliente',
  );
  rejected(`UPDATE "Contact" SET "salesStage"='INVALID';`, /check constraint/);
  rejected(`UPDATE "Contact" SET "ownerUserId"='absent';`, /foreign key/);
  query(`ALTER TABLE "Contact" ALTER COLUMN "salesStage" SET DEFAULT 'CLOSED';`);
  rejected(upgrade, /estado inicial incompatible/);
  console.log(
    'Phase 11 SQL passed: atomic rollback, exact ledger, defaults, preservation, constraints and safe repeat.',
  );
} finally {
  if (created) query('DROP DATABASE neondb WITH (FORCE);', 'postgres');
}
