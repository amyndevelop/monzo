import { test, expect } from '@playwright/test';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { fixture, db, inbound, deliver } from './helpers/whatsapp';
import { captureWebhook } from '../src/modules/whatsapp/core/ingest';
import {
  callbackUrl,
  dispatchJobs,
  processJob,
  publishJobs,
  qstashConfigurationIssues,
  verifyJob,
  type WhatsappJob,
  type QueueFetch,
} from '../src/modules/whatsapp/core/qstash';

test.afterAll(async () => {
  await db.$disconnect();
});
function signature(
  raw: string,
  options: { next?: boolean; sub?: string; exp?: number; issuer?: string } = {},
) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: options.issuer ?? 'Upstash',
      sub: options.sub ?? callbackUrl(),
      exp: options.exp ?? Math.floor(Date.now() / 1000) + 60,
      body: createHash('sha256').update(raw).digest('base64url'),
    }),
  ).toString('base64url');
  const key = options.next
    ? process.env.QSTASH_NEXT_SIGNING_KEY!
    : process.env.QSTASH_CURRENT_SIGNING_KEY!;
  return `${header}.${payload}.${createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url')}`;
}
async function received(f: Awaited<ReturnType<typeof fixture>>) {
  const events = await captureWebhook(db, Buffer.from(JSON.stringify(inbound(f.account))));
  await processJob(db, { kind: 'inbox', id: events[0].id });
  return db.conversation.findFirstOrThrow({ where: { accountId: f.account.id } });
}
async function saveOutbound(f: Awaited<ReturnType<typeof fixture>>, conversationId: string) {
  const key = randomUUID();
  const path = `/api/workspaces/${f.tenant.id}/conversations/${conversationId}/messages`;
  const response = await f.api.post(path, {
    data: { text: 'Respuesta de prueba por eventos', idempotencyKey: key },
  });
  // No token is configured in this test server: durable save succeeds, publication fails visibly.
  expect(response.status()).toBe(503);
  const saved = await db.message.findUniqueOrThrow({
    where: { tenantId_idempotencyKey: { tenantId: f.tenant.id, idempotencyKey: key } },
  });
  return { saved, key, path };
}
test('diagnóstico privado identifica variables faltantes sin devolver secretos y solo para OWNER', async () => {
  const f = await fixture();
  const path = `/api/workspaces/${f.tenant.id}/whatsapp/accounts`;
  const response = await f.api.get(path);
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.processorReady).toBe(false);
  expect(body.processorIssues).toEqual(['QSTASH_TOKEN']);
  expect(JSON.stringify(body)).not.toContain(process.env.QSTASH_CURRENT_SIGNING_KEY!);
  expect(JSON.stringify(body)).not.toContain(process.env.QSTASH_NEXT_SIGNING_KEY!);
  await db.membership.update({
    where: { tenantId_userId: { tenantId: f.tenant.id, userId: f.user.id } },
    data: { role: 'MEMBER' },
  });
  const member = await (await f.api.get(path)).json();
  expect(member.processorReady).toBe(false);
  expect(member.processorIssues).toEqual([]);
  expect(member.canManage).toBe(false);
  await f.api.dispose();
});
test('callback: firma, rotación, caducidad, destino y cuerpo original', async ({ request }) => {
  const raw = JSON.stringify({ kind: 'inbox', id: 'nonexistent-fixture-id' });
  expect(await verifyJob(raw, signature(raw))).toBe(true);
  expect(await verifyJob(raw, signature(raw, { next: true }))).toBe(true);
  expect(await verifyJob(raw + ' ', signature(raw))).toBe(false);
  expect(
    await verifyJob(raw, signature(raw, { sub: 'https://otro-sitio.test/api/jobs/whatsapp' })),
  ).toBe(false);
  expect(await verifyJob(raw, signature(raw, { issuer: 'Other' }))).toBe(false);
  expect(await verifyJob(raw, signature(raw, { exp: Math.floor(Date.now() / 1000) - 60 }))).toBe(
    false,
  );
  expect((await request.post('/api/jobs/whatsapp', { data: raw })).status()).toBe(403);
  expect(
    (
      await request.post('/api/jobs/whatsapp', {
        data: raw + ' ',
        headers: { 'upstash-signature': signature(raw) },
      })
    ).status(),
  ).toBe(403);
  expect((await request.post('/api/jobs/whatsapp', { data: 'x'.repeat(2049) })).status()).toBe(413);
  const extra = JSON.stringify({ kind: 'inbox', id: 'fixture', tenantId: 'untrusted' });
  expect(
    (
      await request.post('/api/jobs/whatsapp', {
        data: extra,
        headers: { 'upstash-signature': signature(extra) },
      })
    ).status(),
  ).toBe(400);
});

test('webhook conserva pendientes cuando falla publicación y callbacks duplicados procesan una vez', async () => {
  const f = await fixture();
  const payload = inbound(f.account);
  expect((await deliver(f.api, payload)).status()).toBe(503);
  expect((await deliver(f.api, payload)).status()).toBe(503);
  const events = await db.whatsappWebhookEvent.findMany({ where: { accountId: f.account.id } });
  expect(events).toHaveLength(1);
  expect(events[0].state).toBe('PENDING');
  expect(events[0].jobPublishedAt).toBeNull();
  expect(events[0].errorCode).toBe('QSTASH_PUBLISH_FAILED');
  const raw = JSON.stringify({ kind: 'inbox', id: events[0].id });
  const responses = await Promise.all(
    [1, 2].map(() =>
      f.api.post('/api/jobs/whatsapp', {
        data: raw,
        headers: { 'upstash-signature': signature(raw) },
      }),
    ),
  );
  expect(responses.map((r) => r.status())).toEqual([200, 200]);
  expect(await db.message.count({ where: { accountId: f.account.id } })).toBe(1);
  expect(
    (await db.conversation.findFirstOrThrow({ where: { accountId: f.account.id } })).unreadCount,
  ).toBe(1);
  expect(
    (await db.whatsappWebhookEvent.findUniqueOrThrow({ where: { id: events[0].id } })).payload,
  ).toBeNull();
  await f.api.dispose();
});

test('contrato QStash publica solamente IDs, conserva fallos y evita republicar lo aceptado', async () => {
  const f = await fixture();
  const events = await captureWebhook(db, Buffer.from(JSON.stringify(inbound(f.account))));
  const job: WhatsappJob = { kind: 'inbox', id: events[0].id };
  const before = process.env.QSTASH_TOKEN;
  process.env.QSTASH_TOKEN = 'explicit-test-transport-only';
  try {
    await expect(
      dispatchJobs(db, [job], async () => ({ ok: false, json: async () => ({}) })),
    ).rejects.toThrow('QSTASH_PUBLISH_FAILED');
    expect(
      (await db.whatsappWebhookEvent.findUniqueOrThrow({ where: { id: job.id } })).jobPublishedAt,
    ).toBeNull();
    let calls = 0;
    const transport: QueueFetch = async (url, init) => {
      calls++;
      expect(url).toBe('https://qstash.upstash.io/v2/batch');
      expect(init.headers.Authorization).toBe('Bearer explicit-test-transport-only');
      const items = JSON.parse(init.body);
      expect(items[0].destination).toBe(callbackUrl());
      expect(JSON.parse(items[0].body)).toEqual(job);
      expect(init.body).not.toContain('Consulta de prueba');
      expect(items[0].headers['Upstash-Retries']).toBe('2');
      return { ok: true, json: async () => items.map(() => ({ messageId: 'msg-fixture' })) };
    };
    await dispatchJobs(db, [job], transport);
    await dispatchJobs(db, [job], transport);
    expect(calls).toBe(1);
    expect(
      (await db.whatsappWebhookEvent.findUniqueOrThrow({ where: { id: job.id } })).jobPublishedAt,
    ).not.toBeNull();
    await expect(
      publishJobs([job], async () => ({ ok: true, json: async () => [] })),
    ).rejects.toThrow('QSTASH_RESPONSE_UNKNOWN');
    const oldUrl = process.env.QSTASH_URL;
    process.env.QSTASH_URL = '"https://qstash-us-east-1.upstash.io"';
    try {
      expect(qstashConfigurationIssues()).toEqual([]);
      await publishJobs([job], async (url) => {
        expect(url).toBe('https://qstash-us-east-1.upstash.io/v2/batch');
        return { ok: true, json: async () => [{ messageId: 'msg-us-fixture' }] };
      });
      process.env.QSTASH_URL = 'https://qstash-us-east-1.upstash.io/v2/publish';
      expect(qstashConfigurationIssues()).toEqual(['QSTASH_URL']);
    } finally {
      if (oldUrl === undefined) delete process.env.QSTASH_URL;
      else process.env.QSTASH_URL = oldUrl;
    }
    process.env.QSTASH_URL = 'https://sitio-ajeno.test';
    try {
      expect(qstashConfigurationIssues()).toEqual(['QSTASH_URL']);
      await expect(publishJobs([job], transport)).rejects.toThrow('QSTASH_NOT_CONFIGURED');
    } finally {
      if (oldUrl === undefined) delete process.env.QSTASH_URL;
      else process.env.QSTASH_URL = oldUrl;
    }
  } finally {
    if (before === undefined) delete process.env.QSTASH_TOKEN;
    else process.env.QSTASH_TOKEN = before;
  }
  await f.api.dispose();
});

test('envío guardado puede reintentarse con la misma clave; callbacks concurrentes no duplican Meta', async () => {
  const f = await fixture();
  const conv = await received(f);
  const { saved, key, path } = await saveOutbound(f, conv.id);
  expect(
    (await f.api.post(path, { data: { text: saved.text, idempotencyKey: key } })).status(),
  ).toBe(503);
  expect(
    await db.message.count({ where: { conversationId: conv.id, direction: 'OUTBOUND' } }),
  ).toBe(1);
  let calls = 0;
  const transport = async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.qstash.' + saved.id }] }),
    };
  };
  await Promise.all([
    processJob(db, { kind: 'outbox', id: saved.id }, transport),
    processJob(db, { kind: 'outbox', id: saved.id }, transport),
  ]);
  expect(calls).toBe(1);
  expect((await db.message.findUniqueOrThrow({ where: { id: saved.id } })).status).toBe('SENT');
  const token = process.env.QSTASH_TOKEN;
  process.env.QSTASH_TOKEN = 'test-transport-only';
  try {
    const next = await saveOutbound(f, conv.id);
    await dispatchJobs(db, [{ kind: 'outbox', id: next.saved.id }], async (_, init) => {
      const batch = JSON.parse(init.body);
      expect(batch.map((item: { body: string }) => JSON.parse(item.body).kind)).toEqual([
        'outbox',
        'watchdog',
      ]);
      expect(batch[1].headers['Upstash-Delay']).toBe('130s');
      return { ok: true, json: async () => batch.map(() => ({ messageId: 'msg-fixture' })) };
    });
  } finally {
    if (token === undefined) delete process.env.QSTASH_TOKEN;
    else process.env.QSTASH_TOKEN = token;
  }
  await f.api.dispose();
});

test('watchdog marca UNKNOWN sin reenviar y recuperación exige propietario de la empresa', async () => {
  const f = await fixture();
  const other = await fixture();
  const conv = await received(f);
  const { saved } = await saveOutbound(f, conv.id);
  await db.message.update({
    where: { id: saved.id },
    data: { status: 'SENDING', attemptedAt: new Date(Date.now() - 180000) },
  });
  const raw = JSON.stringify({ kind: 'watchdog', id: saved.id });
  expect(
    (
      await f.api.post('/api/jobs/whatsapp', {
        data: raw,
        headers: { 'upstash-signature': signature(raw) },
      })
    ).status(),
  ).toBe(200);
  expect((await db.message.findUniqueOrThrow({ where: { id: saved.id } })).status).toBe('UNKNOWN');
  let calls = 0;
  await processJob(db, { kind: 'outbox', id: saved.id }, async () => {
    calls++;
    throw new Error('Should not resend');
  });
  expect(calls).toBe(0);
  expect(
    (
      await f.api.post(`/api/workspaces/${other.tenant.id}/whatsapp/recover`, { data: {} })
    ).status(),
  ).toBe(403);
  await db.membership.update({
    where: { tenantId_userId: { tenantId: f.tenant.id, userId: f.user.id } },
    data: { role: 'MEMBER' },
  });
  expect(
    (await f.api.post(`/api/workspaces/${f.tenant.id}/whatsapp/recover`, { data: {} })).status(),
  ).toBe(403);
  await f.api.dispose();
  await other.api.dispose();
});

test('recepción inválida queda fallida después de tres intentos y admite revisión del propietario', async () => {
  const f = await fixture();
  const payload = inbound(f.account);
  payload.entry[0].changes[0].value.messages[0].timestamp = String(
    Math.floor(Date.now() / 1000) + 864000,
  );
  const [event] = await captureWebhook(db, Buffer.from(JSON.stringify(payload)));
  const job: WhatsappJob = { kind: 'inbox', id: event.id };
  await expect(processJob(db, job)).rejects.toThrow();
  await expect(processJob(db, job)).rejects.toThrow();
  await processJob(db, job);
  const failed = await db.whatsappWebhookEvent.findUniqueOrThrow({ where: { id: event.id } });
  expect(failed.state).toBe('FAILED');
  expect(failed.attempts).toBe(3);
  expect(
    (await f.api.post(`/api/workspaces/${f.tenant.id}/whatsapp/retry`, { data: {} })).status(),
  ).toBe(503);
  const retried = await db.whatsappWebhookEvent.findUniqueOrThrow({ where: { id: event.id } });
  expect(retried.state).toBe('PENDING');
  expect(retried.attempts).toBe(0);
  await f.api.dispose();
});

test('callback saliente revalida la ventana de 24 horas antes de llamar a Meta', async () => {
  const f = await fixture();
  const conv = await received(f);
  const { saved } = await saveOutbound(f, conv.id);
  await db.conversation.update({
    where: { id: conv.id },
    data: { lastInboundAt: new Date(Date.now() - 25 * 3600000) },
  });
  const raw = JSON.stringify({ kind: 'outbox', id: saved.id });
  expect(
    (
      await f.api.post('/api/jobs/whatsapp', {
        data: raw,
        headers: { 'upstash-signature': signature(raw) },
      })
    ).status(),
  ).toBe(200);
  expect((await db.message.findUniqueOrThrow({ where: { id: saved.id } })).errorCode).toBe(
    'WINDOW_CLOSED',
  );
  await f.api.dispose();
});
