import { test, expect } from '@playwright/test';
import { fixture, db, inbound, fakeToken } from './helpers/whatsapp';
import { randomUUID } from 'node:crypto';
import {
  exampleFlow,
  flowSchema,
  flowIssues,
  snapshotSchema,
  interactivePayload,
  type FlowGraph,
} from '../src/modules/automations/definition';
import { mutateFlow, controlConversation } from '../src/modules/automations/core';
import { captureWebhook, processWebhook } from '../src/modules/whatsapp/core/ingest';
import { processOutbound } from '../src/modules/whatsapp/core/outbound';
import { processJob, type QueueFetch } from '../src/modules/whatsapp/core/qstash';
import { type MetaFetch } from '../src/modules/whatsapp/core/meta';

test.afterAll(() => db.$disconnect());
const initialEnvironment = Object.fromEntries(
  [
    'WHATSAPP_PROCESSOR',
    'QSTASH_TOKEN',
    'QSTASH_CURRENT_SIGNING_KEY',
    'QSTASH_NEXT_SIGNING_KEY',
  ].map((key) => [key, process.env[key]]),
);
test.afterEach(() => {
  for (const [key, value] of Object.entries(initialEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const graph = () => structuredClone(exampleFlow);
async function published(source = graph()) {
  const f = await fixture();
  const saved = await mutateFlow(db, f.tenant.id, f.user.id, f.account.id, {
    action: 'save',
    revision: 0,
    graph: source,
  });
  const flow = await mutateFlow(db, f.tenant.id, f.user.id, f.account.id, {
    action: 'publish',
    revision: saved.revision,
  });
  return { ...f, flow };
}
async function receive(
  f: Awaited<ReturnType<typeof published>>,
  text = 'Hola',
  choice?: string,
  ageSeconds = 0,
) {
  const payload = inbound(f.account, undefined, text, ageSeconds);
  if (choice) {
    const value = payload.entry[0].changes[0].value;
    value.messages[0] = {
      ...value.messages[0],
      type: 'interactive',
      interactive: { button_reply: { id: choice, title: 'Título no usado para decidir' } },
    } as (typeof value.messages)[number];
  }
  const raw = Buffer.from(JSON.stringify(payload));
  const [event] = await captureWebhook(db, raw);
  const queued = await processWebhook(db, event.id);
  const message = queued[0]
    ? await db.message.findUniqueOrThrow({ where: { id: queued[0].id } })
    : null;
  const conversation = await db.conversation.findFirstOrThrow({
    where: { accountId: f.account.id },
  });
  return { event, raw, message, conversation };
}
const accepted: MetaFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ messages: [{ id: 'wamid.auto.' + randomUUID() }] }),
});

test('árbol: rechaza ciclos, huérfanos y duplicados; contrato de botones/listas y texto plano', async () => {
  expect(flowIssues(graph())).toEqual([]);
  const cycle = graph();
  cycle.nodes[0].options[0].next = 'inicio';
  expect(flowIssues(cycle).join(' ')).toContain('ciclo');
  const orphan = graph();
  orphan.nodes.push({
    id: 'orphan',
    kind: 'message',
    label: 'Sin conexión',
    text: 'Texto',
    options: [],
  });
  expect(flowIssues(orphan).join(' ')).toContain('sin conectar');
  const duplicate = graph();
  duplicate.nodes[0].options[1].label = duplicate.nodes[0].options[0].label;
  expect(flowIssues(duplicate).join(' ')).toContain('distintas');
  expect(flowSchema.safeParse({ ...graph(), toolUrl: 'https://foreign.test' }).success).toBe(false);
  const snapshot = {
    version: 1 as const,
    flowId: 'f',
    publishedVersion: 1,
    generation: 1,
    nodeId: 'inicio',
    kind: 'menu' as const,
    text: 'Elegí',
    choices: [
      { id: 'a', label: 'Uno' },
      { id: 'b', label: 'Dos' },
    ],
  };
  expect(interactivePayload(snapshot).type).toBe('button');
  expect(
    interactivePayload({
      ...snapshot,
      choices: [1, 2, 3, 4].map((i) => ({ id: String(i), label: 'Opción ' + i })),
    }).type,
  ).toBe('list');
});

test('flujos: aislamiento, roles, revisión optimista y borradores incompletos', async () => {
  const f = await fixture();
  const other = await fixture();
  await expect(
    mutateFlow(db, f.tenant.id, other.user.id, f.account.id, {
      action: 'save',
      revision: 0,
      graph: graph(),
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    mutateFlow(db, f.tenant.id, f.user.id, other.account.id, {
      action: 'save',
      revision: 0,
      graph: graph(),
    }),
  ).rejects.toMatchObject({ status: 403 });
  const draft = await mutateFlow(db, f.tenant.id, f.user.id, f.account.id, {
    action: 'save',
    revision: 0,
    graph: { name: 'Borrador', start: '', nodes: [] },
  });
  expect(draft.enabled).toBe(false);
  await expect(
    mutateFlow(db, f.tenant.id, f.user.id, f.account.id, {
      action: 'publish',
      revision: draft.revision,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    mutateFlow(db, f.tenant.id, f.user.id, f.account.id, {
      action: 'save',
      revision: 0,
      graph: graph(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  await db.membership.create({
    data: { tenantId: f.tenant.id, userId: other.user.id, role: 'MEMBER' },
  });
  await expect(
    mutateFlow(db, f.tenant.id, other.user.id, f.account.id, {
      action: 'save',
      revision: draft.revision,
      graph: graph(),
    }),
  ).rejects.toMatchObject({ status: 403 });
});

test('runtime: webhook duplicado, menú real, opción por ID y derivación sin bucles', async () => {
  const f = await published();
  const first = await receive(f);
  expect(first.message?.type).toBe('interactive');
  const snapshot = snapshotSchema.parse(first.message!.automationSnapshot);
  const bodies: Record<string, unknown>[] = [];
  await processOutbound(db, first.message!.id, async (_, init) => {
    expect(init.headers.Authorization).toBe('Bearer ' + fakeToken);
    bodies.push(JSON.parse(init.body!));
    return accepted('', init);
  });
  expect(bodies[0]).toMatchObject({
    type: 'interactive',
    biz_opaque_callback_data: first.message!.id,
    interactive: { type: 'button', body: { text: exampleFlow.nodes[0].text } },
  });
  await captureWebhook(db, first.raw);
  await processWebhook(db, first.event.id);
  expect(
    await db.message.count({ where: { automationSourceId: first.message!.automationSourceId } }),
  ).toBe(1);
  const second = await receive(f, '', snapshot.choices[1].id);
  expect(second.message?.text).toContain('integrante del equipo');
  await processOutbound(db, second.message!.id, accepted);
  expect((await receive(f, 'Quiero consultar algo más')).message).toBeNull();
  expect((await receive(f, 'MENÚ')).message).toBeNull();
  expect(
    (await db.message.findMany({ where: { accountId: f.account.id, direction: 'OUTBOUND' } }))
      .length,
  ).toBe(2);
});

test('runtime: guardar no altera publicado, publicar invalida menús y pausa cancela cola', async () => {
  const f = await published();
  const first = await receive(f);
  const snapshot = snapshotSchema.parse(first.message!.automationSnapshot);
  const edited = graph();
  edited.nodes[0].text = 'Nuevo menú';
  const draft = await mutateFlow(db, f.tenant.id, f.user.id, f.account.id, {
    action: 'save',
    revision: f.flow.revision,
    graph: edited,
  });
  expect((draft.published as unknown as FlowGraph).nodes[0].text).not.toBe('Nuevo menú');
  const live = await mutateFlow(db, f.tenant.id, f.user.id, f.account.id, {
    action: 'publish',
    revision: draft.revision,
  });
  let calls = 0;
  await processOutbound(db, first.message!.id, async (...args) => {
    calls++;
    return accepted(...args);
  });
  expect(calls).toBe(0);
  const stale = await receive({ ...f, flow: live }, '', snapshot.choices[0].id);
  expect(snapshotSchema.parse(stale.message!.automationSnapshot).nodeId).toBe('inicio');
  const paused = await mutateFlow(db, f.tenant.id, f.user.id, f.account.id, {
    action: 'pause',
    revision: live.revision,
  });
  expect(paused.enabled).toBe(false);
  expect((await db.message.findUniqueOrThrow({ where: { id: stale.message!.id } })).status).toBe(
    'CANCELED',
  );
  expect((await receive(f)).message).toBeNull();
});

test('runtime: atención humana cancela pendientes, leer no pausa y reanudar espera otro mensaje', async () => {
  const f = await published();
  const first = await receive(f);
  const path = `/api/workspaces/${f.tenant.id}/conversations/${first.conversation.id}`;
  expect(
    (await f.api.patch(path, { data: { readThroughId: first.message!.automationSourceId } })).ok(),
  ).toBe(true);
  expect(
    (await db.conversation.findUniqueOrThrow({ where: { id: first.conversation.id } }))
      .automationPaused,
  ).toBe(false);
  const manual = await f.api.post(path + '/messages', {
    data: { text: 'Ahora te atiendo yo', idempotencyKey: randomUUID() },
  });
  expect(manual.ok()).toBe(true);
  expect(
    (await db.conversation.findUniqueOrThrow({ where: { id: first.conversation.id } }))
      .automationPaused,
  ).toBe(true);
  expect((await db.message.findUniqueOrThrow({ where: { id: first.message!.id } })).status).toBe(
    'CANCELED',
  );
  expect((await receive(f, '1')).message).toBeNull();
  const previous = await db.message.count({
    where: { accountId: f.account.id, direction: 'OUTBOUND' },
  });
  await controlConversation(db, f.tenant.id, f.user.id, first.conversation.id, 'resume');
  expect(
    await db.message.count({ where: { accountId: f.account.id, direction: 'OUTBOUND' } }),
  ).toBe(previous);
  expect((await receive(f)).message?.type).toBe('interactive');
  await f.api.patch(path, { data: { assignedUserId: f.user.id } });
  await expect(
    controlConversation(db, f.tenant.id, f.user.id, first.conversation.id, 'resume'),
  ).rejects.toMatchObject({ status: 409 });
});

test('runtime: rechazos desconocidos derivan, ventana/canal/rol se revalidan antes de Meta', async () => {
  const f = await published();
  const first = await receive(f);
  for (let i = 0; i < 3; i++) await receive(f, 'No es una opción');
  const current = await db.conversation.findUniqueOrThrow({ where: { id: first.conversation.id } });
  expect((current.automationState as { status: string }).status).toBe('handoff');
  const last = await db.message.findFirstOrThrow({
    where: { conversationId: current.id, status: 'QUEUED' },
    orderBy: { createdAt: 'desc' },
  });
  expect(last.text).not.toContain('Elegí una opción');
  await db.membership.update({
    where: { tenantId_userId: { tenantId: f.tenant.id, userId: f.user.id } },
    data: { role: 'MEMBER' },
  });
  const threadStatus = await (
    await f.api.get(`/api/workspaces/${f.tenant.id}/conversations/${current.id}`)
  ).json();
  expect(threadStatus.automation.enabled).toBe(false);
  let calls = 0;
  await processOutbound(db, last.id, async (...args) => {
    calls++;
    return accepted(...args);
  });
  expect(calls).toBe(0);
  expect((await db.message.findUniqueOrThrow({ where: { id: last.id } })).status).toBe('CANCELED');
  const other = await published();
  const menu = await receive(other);
  await db.conversation.update({
    where: { id: menu.conversation.id },
    data: { lastInboundAt: new Date(Date.now() - 25 * 3600000) },
  });
  await processOutbound(db, menu.message!.id, async (...args) => {
    calls++;
    return accepted(...args);
  });
  expect(calls).toBe(0);
  expect((await db.message.findUniqueOrThrow({ where: { id: menu.message!.id } })).errorCode).toBe(
    'WINDOW_CLOSED',
  );
  expect((await receive(other, 'Viejo', undefined, 26 * 3600)).message).toBeNull();
});

test('QStash: una recepción programa solo IDs; reintentos no duplican el envío', async () => {
  const f = await published();
  process.env.WHATSAPP_PROCESSOR = 'qstash';
  process.env.QSTASH_TOKEN = 'fixture-qstash';
  process.env.QSTASH_CURRENT_SIGNING_KEY = 'fixture-current';
  process.env.QSTASH_NEXT_SIGNING_KEY = 'fixture-next';
  const [event] = await captureWebhook(db, Buffer.from(JSON.stringify(inbound(f.account))));
  const jobs: { kind: 'outbox' | 'watchdog'; id: string }[] = [];
  const queue: QueueFetch = async (_, init) => {
    const batch = JSON.parse(init.body);
    for (const item of batch) jobs.push(JSON.parse(item.body));
    return { ok: true, json: async () => batch.map(() => ({ messageId: randomUUID() })) };
  };
  await processJob(db, { kind: 'inbox', id: event.id }, undefined, queue);
  await processJob(db, { kind: 'inbox', id: event.id }, undefined, queue);
  expect(jobs.map((job) => job.kind)).toEqual(['outbox', 'watchdog']);
  expect(Object.keys(jobs[0]).sort()).toEqual(['id', 'kind']);
  let calls = 0;
  const transport: MetaFetch = async (...args) => {
    calls++;
    return accepted(...args);
  };
  await Promise.all([processJob(db, jobs[0], transport), processJob(db, jobs[0], transport)]);
  expect(calls).toBe(1);
});

test('API: origen, tamaños, números ajenos y lectura por miembros', async () => {
  const f = await fixture();
  const other = await fixture();
  const path = `/api/workspaces/${f.tenant.id}/automations/${f.account.id}`;
  expect((await other.api.get(path)).status()).toBe(403);
  expect(
    (
      await f.api.post(path, {
        headers: { origin: 'https://foreign.test' },
        data: { action: 'save', revision: 0, graph: graph() },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await f.api.post(path, {
        data: { action: 'save', revision: 0, graph: { ...graph(), name: 'a'.repeat(180001) } },
      })
    ).status(),
  ).toBe(413);
  const saved = await f.api.post(path, { data: { action: 'save', revision: 0, graph: graph() } });
  expect(saved.ok()).toBe(true);
  const body = await saved.json();
  expect(JSON.stringify(body)).not.toContain(fakeToken);
  expect(
    (await f.api.get(`/api/workspaces/${f.tenant.id}/automations/${other.account.id}`)).status(),
  ).toBe(403);
});

test('UI: borrador, validación, simulador con foco y árbol en escritorio/móvil', async ({
  page,
}, testInfo) => {
  const f = await fixture();
  await f.api.post('/api/workspaces/active', { data: { tenantId: f.tenant.id } });
  await page.context().addCookies((await f.api.storageState()).cookies);
  await page.goto('/dashboard/automatizaciones');
  await page.getByRole('button', { name: 'Usar ejemplo editable' }).click();
  await expect(page.getByRole('button', { name: 'Publicar y activar' })).toBeDisabled();
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Borrador guardado.' })).toBeVisible();
  const simulator = page.getByRole('button', { name: 'Probar recorrido' });
  await simulator.click();
  const dialog = page.getByRole('dialog', { name: 'Probar recorrido' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Hablar con alguien' }).click();
  await expect(
    dialog.getByText('La automatización se detiene y la conversación queda para el equipo.'),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(simulator).toBeFocused();
  await page.getByLabel('Mensaje para el cliente').fill('Bienvenida revisada');
  await page.route('**/automations/' + f.account.id, async (route) => {
    if (route.request().method() === 'POST')
      await route.fulfill({ status: 503, json: { error: 'Fallo de guardado de prueba' } });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Fallo de guardado de prueba' }),
  ).toBeVisible();
  await expect(page.getByLabel('Mensaje para el cliente')).toHaveValue('Bienvenida revisada');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `work/flows-${testInfo.project.name}.png`, fullPage: true });
});

test('sesión: fin, reinicio, menú obsoleto y mensajes demorados', async () => {
  const f = await published();
  const first = await receive(f);
  const old = snapshotSchema.parse(first.message!.automationSnapshot);
  const answer = await receive(f, '1');
  expect(answer.message?.text).toContain('MENÚ');
  expect((await receive(f, 'Gracias')).message).toBeNull();
  const restart = await receive(f, 'MENÚ');
  expect(restart.message?.type).toBe('interactive');
  const stale = await receive(f, '', old.choices[0].id);
  expect(stale.message?.text).toContain('Elegí una opción');
  const before = await db.message.count({
    where: { accountId: f.account.id, direction: 'OUTBOUND' },
  });
  expect((await receive(f, '1', undefined, 60)).message).toBeNull();
  expect(
    await db.message.count({ where: { accountId: f.account.id, direction: 'OUTBOUND' } }),
  ).toBe(before);
});

test('límite y lista: seis respuestas por minuto; cuatro opciones usan lista', async () => {
  const source = graph();
  source.nodes[0].options = [1, 2, 3, 4].map((i) => ({
    id: 'op' + i,
    label: 'Opción ' + i,
    next: i === 1 ? 'equipo' : 'horarios',
  }));
  const f = await published(source);
  const first = await receive(f);
  let body: Record<string, unknown> | undefined;
  await processOutbound(db, first.message!.id, async (url, init) => {
    body = JSON.parse(init.body!);
    return accepted(url, init);
  });
  expect(body).toMatchObject({
    type: 'interactive',
    interactive: { type: 'list', action: { button: 'Ver opciones' } },
  });
  for (let i = 0; i < 6; i++) await receive(f, 'MENÚ');
  expect(
    await db.message.count({ where: { accountId: f.account.id, automationFlowId: { not: null } } }),
  ).toBe(6);
  const conversation = await db.conversation.findUniqueOrThrow({
    where: { id: first.conversation.id },
  });
  expect(conversation.automationPaused).toBe(true);
  expect((conversation.automationState as { status: string }).status).toBe('blocked');
});

test('pausar no repite ni retira un envío que ya fue reclamado', async () => {
  const f = await published();
  const first = await receive(f);
  let calls = 0;
  await processOutbound(db, first.message!.id, async (...args) => {
    calls++;
    await controlConversation(db, f.tenant.id, f.user.id, first.conversation.id, 'pause');
    return accepted(...args);
  });
  expect(calls).toBe(1);
  expect((await db.message.findUniqueOrThrow({ where: { id: first.message!.id } })).status).toBe(
    'SENT',
  );
  await processOutbound(db, first.message!.id, async (...args) => {
    calls++;
    return accepted(...args);
  });
  expect(calls).toBe(1);
  expect((await receive(f)).message).toBeNull();
});

test('UI: tomar atención y reanudar conservan borrador y compositor', async ({
  page,
}, testInfo) => {
  const f = await published();
  const first = await receive(f);
  await f.api.post('/api/workspaces/active', { data: { tenantId: f.tenant.id } });
  await page.context().addCookies((await f.api.storageState()).cookies);
  await page.goto('/dashboard/conversaciones?conversation=' + first.conversation.id);
  const draft = page.getByLabel('Mensaje de WhatsApp', { exact: true });
  await draft.fill('Borrador del operador');
  await page.getByRole('button', { name: 'Tomar atención' }).click();
  const resume = page.getByRole('button', { name: 'Reanudar flujo' });
  await expect(resume).toBeVisible();
  await expect(draft).toHaveValue('Borrador del operador');
  await resume.click();
  await expect(page.getByRole('button', { name: 'Tomar atención' })).toBeVisible();
  await expect(draft).toHaveValue('Borrador del operador');
  const box = await draft.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `work/flows-chat-${testInfo.project.name}.png`, fullPage: true });
});
