import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
const upgrade = readFileSync('docs/sql/phase-12-upgrade.sql', 'utf8');
function rejected(sql, pattern, database) {
  assert.throws(
    () => query(sql, database),
    (e) => pattern.test(String(e.stderr)),
  );
}
let created = false;
try {
  assert.equal(query("SELECT count(*) FROM pg_database WHERE datname='neondb';", 'postgres'), '0');
  query('CREATE DATABASE neondb;', 'postgres');
  created = true;
  rejected(upgrade, /elegi la base neondb/, 'postgres');
  rejected(upgrade, /falta el esquema/);
  for (const phase of [2, 3, 4, 5, 6, 7, 10])
    query(
      readFileSync(`docs/sql/phase-${phase}-${phase === 2 ? 'bootstrap' : 'upgrade'}.sql`, 'utf8'),
    );
  query(
    `INSERT INTO "User"(id,email,"updatedAt") VALUES ('qr-user','qr@example.test',now()); INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES ('qr-tenant','QR','qr',now()); INSERT INTO "WhatsappAccount"(id,"tenantId","phoneNumberId","businessAccountId","displayPhone","displayName","tokenEncrypted","updatedAt") VALUES ('qr-account','qr-tenant','12345','23456','Prueba','Original','ENCRYPTED_EXISTING',now()); INSERT INTO "Contact"(id,"tenantId","accountId","waId",name,"updatedAt") VALUES ('qr-contact','qr-tenant','qr-account','12345','Original',now());`,
  );
  const old = () => query(`SELECT name||'|'||"waId" FROM "Contact" WHERE id='qr-contact';`);
  const before = old();
  query(
    `CREATE FUNCTION reject_qr_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.migration_name='202611050001_whatsapp_qr' THEN RAISE EXCEPTION 'simulated QR failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_qr_history BEFORE INSERT ON _prisma_migrations FOR EACH ROW EXECUTE FUNCTION reject_qr_history();`,
  );
  rejected(upgrade, /simulated QR failure/);
  assert.equal(
    query(
      `SELECT count(*) FROM information_schema.columns WHERE table_name='Contact' AND column_name='salesStage';`,
    ),
    '0',
  );
  assert.equal(
    query(`SELECT count(*) FROM information_schema.tables WHERE table_name='WhatsappWebSession';`),
    '0',
  );
  query('DROP TRIGGER reject_qr_history ON _prisma_migrations; DROP FUNCTION reject_qr_history();');
  assert.equal(query(upgrade), 'neondb|1|15|11');
  assert.equal(old(), before);
  assert.equal(
    query(`SELECT provider||'|'||"tokenEncrypted" FROM "WhatsappAccount" WHERE id='qr-account';`),
    'META|ENCRYPTED_EXISTING',
  );
  query(
    `UPDATE "Contact" SET "crmName"='Editado',tags=ARRAY['Cliente']; INSERT INTO "WhatsappWebSession"("accountId","tenantId","expectedWaId","authEncrypted","updatedAt") VALUES ('qr-account','qr-tenant','15550000000','ENCRYPTED_SESSION',now());`,
  );
  const ledger = query(
    'SELECT row_to_json(m)::text FROM _prisma_migrations m ORDER BY migration_name;',
  );
  assert.equal(query(upgrade), 'neondb|1|15|11');
  assert.equal(
    query('SELECT row_to_json(m)::text FROM _prisma_migrations m ORDER BY migration_name;'),
    ledger,
  );
  assert.equal(query(`SELECT "crmName" FROM "Contact" WHERE id='qr-contact';`), 'Editado');
  assert.equal(query(`SELECT "authEncrypted" FROM "WhatsappWebSession";`), 'ENCRYPTED_SESSION');
  rejected(`UPDATE "WhatsappAccount" SET provider='INVALID';`, /check constraint/);
  rejected(`UPDATE "WhatsappWebSession" SET "expectedWaId"='invalid';`, /check constraint/);
  rejected(`UPDATE "WhatsappWebSession" SET "tenantId"='foreign';`, /foreign key/);
  console.log(
    'QR SQL passed: combined upgrade from nine migrations, rollback, exact ledger, old credentials preserved, safe repeat and tenant constraints.',
  );
} finally {
  if (created) query('DROP DATABASE neondb WITH (FORCE);', 'postgres');
}
