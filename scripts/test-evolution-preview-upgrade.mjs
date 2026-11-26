import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  baselineMigrations,
  baselineSql,
  fingerprintSql,
  migrationTableSql,
} from './evolution-preview-baseline.mjs';
import { evolutionMigration, evolutionUpgradeSql } from './evolution-preview-upgrade.mjs';
import { localPreviewPostgres } from './evolution-preview-local-postgres.mjs';

const local = localPreviewPostgres();
const reference = localPreviewPostgres();
const fingerprint = (db) =>
  JSON.parse(db.query('SET search_path=public,pg_catalog;' + fingerprintSql + ';'));
const rejected = (sql, pattern) =>
  assert.throws(
    () => local.query(sql),
    (error) => pattern.test(String(error.stderr)),
  );
try {
  local.create();
  reference.create();
  const migrations = baselineMigrations();
  const initial = migrationTableSql + migrations.map((m) => m.sql).join('\n');
  local.query(initial);
  reference.query(initial);
  const before = fingerprint(local);
  reference.query(evolutionMigration().sql);
  const after = fingerprint(reference);
  const sql = evolutionUpgradeSql(migrations, before, after, local.database);
  const artifact = evolutionUpgradeSql(migrations, before, after);
  assert.equal(readFileSync('docs/sql/evolution-preview-upgrade.sql', 'utf8'), artifact);
  const ledger = () =>
    local.query('SELECT row_to_json(h) FROM _prisma_migrations h ORDER BY migration_name;');
  const noUpgrade = () => {
    assert.equal(local.query('SELECT count(*) FROM _prisma_migrations;'), '11');
    assert.equal(local.query('SELECT to_regclass(\'public."EvolutionSession"\') IS NULL;'), 't');
    assert.deepEqual(fingerprint(local), before);
  };

  // Neither a different database nor ordinary production migration IDs qualify.
  rejected(artifact, /selecciona la base de pruebas/);
  rejected(sql, /historial previo incompatible/);
  local.query(baselineSql(migrations, before, local.database));
  local.query(
    `UPDATE _prisma_migrations SET id='ordinary-production-id' WHERE migration_name='${migrations[0].name}';`,
  );
  const productionLedger = ledger();
  rejected(sql, /falta la marca del baseline de pruebas/);
  assert.equal(ledger(), productionLedger);
  noUpgrade();
  local.query(`UPDATE _prisma_migrations SET id=md5('monzo-preview-baseline:'||migration_name);`);
  const originalLedger = ledger();

  for (const ddl of [
    `UPDATE _prisma_migrations SET checksum=repeat('0',64);`,
    `UPDATE _prisma_migrations SET finished_at=NULL;`,
    `UPDATE _prisma_migrations SET rolled_back_at=now();`,
    'ALTER TABLE "User" ALTER COLUMN email DROP NOT NULL;',
    'ALTER TABLE "WhatsappAccount" DROP CONSTRAINT "WhatsappAccount_provider_check";',
    'CREATE INDEX upgrade_unexpected ON "Tenant"(name);',
  ]) {
    rejected(
      'BEGIN;' + ddl + sql + 'COMMIT;',
      /historial previo incompatible|estructura incompatible/,
    );
    noUpgrade();
    assert.equal(ledger(), originalLedger);
  }

  local.query(`
    INSERT INTO "User"(id,email,name,"emailVerified","updatedAt") VALUES ('upgrade-user','fixture@example.invalid','Prueba',true,now());
    INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES ('upgrade-tenant','Empresa de prueba','upgrade-tenant',now()),('upgrade-other','Otra empresa','upgrade-other',now());
    INSERT INTO "Membership"(id,"userId","tenantId",role,"updatedAt") VALUES ('upgrade-member','upgrade-user','upgrade-tenant','OWNER',now());
    INSERT INTO "WhatsappAccount"(id,"tenantId","phoneNumberId","businessAccountId","displayPhone","displayName","tokenEncrypted","updatedAt")
      VALUES ('upgrade-meta','upgrade-tenant','12345678','87654321','+15551234567','Meta existente','fixture-ciphertext-not-a-key',now());
    INSERT INTO "Contact"(id,"tenantId","accountId","waId","updatedAt") VALUES ('upgrade-contact','upgrade-tenant','upgrade-meta','15557654321',now());
    INSERT INTO "Conversation"(id,"tenantId","accountId","contactId","updatedAt") VALUES ('upgrade-chat','upgrade-tenant','upgrade-meta','upgrade-contact',now());
    INSERT INTO "Message"(id,"tenantId","accountId","conversationId",direction,status,type,text,"occurredAt","updatedAt")
      VALUES ('upgrade-message','upgrade-tenant','upgrade-meta','upgrade-chat','INBOUND','RECEIVED','text','Mensaje previo',now(),now());
  `);
  const data = () =>
    local.query(`
    SELECT jsonb_build_object(
      'users',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "User" t),
      'tenants',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "Tenant" t),
      'memberships',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "Membership" t),
      'accounts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "WhatsappAccount" t),
      'contacts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "Contact" t),
      'chats',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM "Conversation" t),
      'messages',(SELECT jsonb_agg(to_jsonb(t)-'channelGeneration' ORDER BY id) FROM "Message" t));
  `);
  const originalData = data();
  // A failure after all DDL must roll back the provider constraint, new tables and column.
  const failAfterDdl = sql.replace(
    ' INSERT INTO public._prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count)',
    " RAISE EXCEPTION 'forced-upgrade-rollback'; INSERT INTO public._prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count)",
  );
  assert.notEqual(failAfterDdl, sql);
  rejected(failAfterDdl, /forced-upgrade-rollback/);
  noUpgrade();
  assert.equal(ledger(), originalLedger);
  assert.equal(data(), originalData);

  assert.equal(local.query(sql), local.database + '|12|1|1|1|1|2');
  assert.deepEqual(fingerprint(local), after);
  assert.equal(data(), originalData);
  assert.equal(local.query('SELECT "channelGeneration" IS NULL FROM "Message";'), 't');
  const complete = ledger();
  assert.equal(local.query(sql), local.database + '|12|1|1|1|1|2');
  assert.equal(ledger(), complete);
  assert.equal(data(), originalData);

  // Check the boundaries used by the forthcoming callback and channel routes.
  local.query(`
    INSERT INTO "WhatsappAccount"(id,"tenantId",provider,"phoneNumberId","businessAccountId","displayPhone","displayName","updatedAt")
      VALUES ('upgrade-evo','upgrade-tenant','EVOLUTION','11111111','evolution','+15551234567','Evolution',now()),
             ('upgrade-evo-other','upgrade-other','EVOLUTION','22222222','evolution','+15551234567','Otra',now());
    INSERT INTO "EvolutionSession"("accountId","tenantId","expectedWaId","desiredState","updatedAt")
      VALUES ('upgrade-evo','upgrade-tenant','15551234567','CONNECTED',now()),
             ('upgrade-evo-other','upgrade-other','15551234567','DISCONNECTED',now());
  `);
  rejected(
    "UPDATE \"WhatsappAccount\" SET provider='UNKNOWN' WHERE id='upgrade-evo';",
    /provider_check/,
  );
  rejected(
    'UPDATE "EvolutionSession" SET "desiredState"=\'CONNECTED\' WHERE "accountId"=\'upgrade-evo-other\';',
    /active_phone_key/,
  );
  rejected(
    'UPDATE "EvolutionSession" SET "tenantId"=\'upgrade-other\', "expectedWaId"=\'15559999999\' WHERE "accountId"=\'upgrade-evo\';',
    /accountId_tenantId_fkey/,
  );
  rejected(
    'UPDATE "EvolutionSession" SET "connectedWaId"=\'15550000000\' WHERE "accountId"=\'upgrade-evo\';',
    /identity_check/,
  );
  rejected(
    'UPDATE "EvolutionSession" SET "expectedWaId"=\'invalid\' WHERE "accountId"=\'upgrade-evo\';',
    /phone_check/,
  );
  rejected(
    'UPDATE "EvolutionSession" SET generation=0 WHERE "accountId"=\'upgrade-evo\';',
    /generation_check/,
  );
  rejected('UPDATE "Message" SET "channelGeneration"=0;', /channelGeneration_check/);
  const delivery = `INSERT INTO "EvolutionDelivery"(id,"tenantId","accountId",generation,sequence,digest) VALUES(repeat('a',64),'upgrade-tenant','upgrade-evo',1,1,repeat('b',64));`;
  local.query(delivery);
  rejected(delivery, /EvolutionDelivery_pkey/);
  rejected(
    delivery
      .replace("repeat('a',64)", "repeat('c',64)")
      .replace("'upgrade-tenant'", "'upgrade-other'"),
    /accountId_tenantId_fkey/,
  );
  rejected(
    delivery.replace("repeat('a',64)", "repeat('c',64)").replace(',1,1,', ',1,0,'),
    /generation_check/,
  );
  console.log(
    'Upgrade Evolution comprobado en PostgreSQL 17: doce checksums, datos preservados, rollback, repeticion, rechazo del historial de produccion, deriva y limites entre empresas/telefonos/generaciones. Solo bases temporales locales.',
  );
} finally {
  reference.close();
  local.close();
}
