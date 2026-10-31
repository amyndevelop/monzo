import { test, expect } from '@playwright/test';
import { fixture, db, inbound } from './helpers/whatsapp';
import { mutateVariable, variableDefinition } from '../src/modules/automations/variable-registry';
import {
  variableSchema,
  parseValue,
  compareValue,
  type VariableDefinition,
} from '../src/modules/automations/variables';
import { variableExample } from '../src/modules/automations/examples';
import { flowIssues, type FlowGraph } from '../src/modules/automations/definition';
import { advanceFlow, interpolate } from '../src/modules/automations/engine';
import { mutateFlow } from '../src/modules/automations/core';
import { captureWebhook, processWebhook } from '../src/modules/whatsapp/core/ingest';
import { processOutbound } from '../src/modules/whatsapp/core/outbound';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
test.afterAll(() => db.$disconnect());
const def = (
  identifier = 'valor',
  type: VariableDefinition['type'] = 'text',
): VariableDefinition => ({
  identifier,
  name: identifier,
  type,
  description: '',
  scope: 'execution',
  defaultValue: null,
  currency: 'ARS',
});
async function setup() {
  const f = await fixture();
  const { graph } = variableExample();
  for (const variable of graph.variables!)
    await mutateVariable(db, f.tenant.id, f.user.id, { action: 'create', variable });
  const saved = await mutateFlow(db, f.tenant.id, f.user.id, f.account.id, {
    action: 'save',
    revision: 0,
    graph,
  });
  const flow = await mutateFlow(db, f.tenant.id, f.user.id, f.account.id, {
    action: 'publish',
    revision: saved.revision,
  });
  return { ...f, flow, graph };
}
async function event(
  f: Awaited<ReturnType<typeof setup>>,
  text: string,
  choice?: string,
  waId = '5491112345678',
  timestamp?: number,
) {
  const payload = inbound(f.account, undefined, text);
  const value = payload.entry[0].changes[0].value;
  if (timestamp !== undefined) value.messages[0].timestamp = String(timestamp);
  value.contacts[0].wa_id = waId;
  value.messages[0].from = waId;
  if (choice)
    value.messages[0] = {
      ...value.messages[0],
      type: 'interactive',
      interactive: { button_reply: { id: choice, title: 'Selección' } },
    } as (typeof value.messages)[number];
  const raw = Buffer.from(JSON.stringify(payload));
  const [record] = await captureWebhook(db, raw);
  return { record, raw };
}
async function reply(
  f: Awaited<ReturnType<typeof setup>>,
  text: string,
  choice?: string,
  waId = '5491112345678',
  timestamp?: number,
) {
  const input = await event(f, text, choice, waId, timestamp);
  await processWebhook(db, input.record.id);
  const conversation = await db.conversation.findFirstOrThrow({
    where: { tenantId: f.tenant.id, contact: { waId } },
  });
  const message = await db.message.findFirstOrThrow({
    where: { automationEventId: input.record.id, conversationId: conversation.id },
  });
  const snapshot = message.automationSnapshot as { choices: { id: string; label: string }[] };
  return { ...input, conversation, message, snapshot };
}
test('tipos, defaults, precisión decimal, operadores y sustitución sin ejecutar contenido', () => {
  const cases: [VariableDefinition['type'], string, string][] = [
    ['text', '  Ana  ', 'Ana'],
    ['integer', '+001000', '1000'],
    ['decimal', '-12,500', '-12.5'],
    ['currency', '15400', '15400'],
    ['boolean', 'Sí', 'true'],
    ['date', '2028-02-29', '2028-02-29'],
    ['datetime', '2026-12-15T14:30-03:00', '2026-12-15T17:30:00.000Z'],
    ['url', 'https://example.com/perfil', 'https://example.com/perfil'],
  ];
  for (const [type, value, expected] of cases)
    expect(parseValue(def('valor', type), value)).toBe(expected);
  for (const [type, value] of [
    ['integer', '1.5'],
    ['decimal', 'NaN'],
    ['currency', '1e5'],
    ['boolean', 'quizá'],
    ['date', '2026-02-29'],
    ['datetime', '2026-02-30T10:00Z'],
    ['url', 'javascript:alert(1)'],
  ] as const)
    expect(() => parseValue(def('valor', type), value)).toThrow();
  expect(
    compareValue(
      def('valor', 'decimal'),
      { valor: '999999999999999.000002' },
      'gt',
      '999999999999999.000001',
    ),
  ).toBe(true);
  expect(compareValue(def('valor', 'integer'), { valor: '-2' }, 'lte', '-1')).toBe(true);
  expect(
    compareValue(
      def('valor', 'url'),
      { valor: 'https://example.com/A' },
      'equals',
      'https://example.com/a',
    ),
  ).toBe(false);
  expect(parseValue(def('nacimiento', 'date'), '1965-12-15')).toBe('1965-12-15');
  expect(compareValue(def(), {}, 'empty')).toBe(true);
  expect(compareValue(def('valor', 'boolean'), { valor: 'false' }, 'false')).toBe(true);
  expect(compareValue(def(), { valor: 'ÁNA Premium' }, 'not_contains', 'básico')).toBe(true);
  expect(variableSchema.safeParse({ ...def(), identifier: 'constructor' }).success).toBe(false);
  const graph: FlowGraph = {
    name: 'Texto',
    start: 'fin',
    variables: [{ ...def(), defaultValue: 'Hola' }],
    nodes: [
      { id: 'fin', label: 'Fin', kind: 'message', text: '{{valor}}\n{{valor}}', options: [] },
    ],
  };
  expect(flowIssues(graph)).toEqual([]);
  expect(advanceFlow(graph, null, { text: '' }).text).toBe('Hola\nHola');
  expect(interpolate(graph, '{{valor}}', { valor: '{{otra}}' })).toBe('{{otra}}');
  expect(() => interpolate(graph, '{{inexistente}}', {})).toThrow();
  expect(interpolate(graph, '{{inexistente}}', {}, true)).toContain('sin definir');
});
test('motor: confirmación, volver atrás, múltiples asignaciones, copia, limpieza y protección de ciclos', () => {
  const { graph } = variableExample();
  expect(flowIssues(graph)).toEqual([]);
  let state = advanceFlow(graph, null, { text: '' });
  for (const optionId of ['red0', 'servicio0', 'cantidad2'])
    state = advanceFlow(graph, state, { text: '', optionId });
  expect(state.text).toContain('1000 de Seguidores para Instagram');
  expect(state.variables.precio).toBe('15400');
  state = advanceFlow(graph, JSON.parse(JSON.stringify(state)), { text: '', optionId: 'no' });
  state = advanceFlow(graph, state, { text: '', optionId: 'cantidad1' });
  expect(state.text).toContain('500 de Seguidores para Instagram');
  state = advanceFlow(graph, state, { text: '', optionId: 'si' });
  expect(state.variables).toMatchObject({
    red_social: 'Instagram',
    servicio: 'Seguidores',
    cantidad: '500',
    precio: '7700',
    estado_pedido: 'Confirmado',
    copia_servicio: 'Seguidores',
  });
  const automatic = structuredClone(graph);
  automatic.nodes.find((n) => n.id === 'guardar')!.options[0].next = 'guardar';
  expect(flowIssues(automatic).join(' ')).toContain('ciclo');
  const missing = structuredClone(graph);
  missing.nodes[0].text = 'Hola {{cantidad}}';
  expect(flowIssues(missing).join(' ')).toContain('debe guardarse antes');
  expect(
    advanceFlow(graph, { ...state, status: 'waiting', nodeId: 'red', turns: 100 }, { text: '1' })
      .status,
  ).toBe('blocked');
  const clear: FlowGraph = {
    name: 'Limpiar',
    start: 'asignar',
    variables: [{ ...def(), defaultValue: 'Inicial' }],
    nodes: [
      {
        id: 'asignar',
        label: 'Limpiar',
        kind: 'assign',
        text: '',
        assignments: [{ variable: 'valor', operation: 'clear', value: '' }],
        options: [{ id: 'seguir', label: 'Seguir', next: 'evaluar' }],
      },
      {
        id: 'evaluar',
        label: 'Vacío',
        kind: 'condition',
        text: '',
        variable: 'valor',
        operator: 'empty',
        options: [
          { id: 'si', label: 'Sí', next: 'fin' },
          { id: 'no', label: 'No', next: 'fin' },
        ],
      },
      { id: 'fin', label: 'Fin', kind: 'message', text: 'Listo', options: [] },
    ],
  };
  expect(flowIssues(clear)).toEqual([]);
  expect(advanceFlow(clear, null, { text: '' }).variables.valor).toBe('');
});
test('catálogo: CRUD, duplicados, revisiones, referencias, permisos y snapshots publicados', async () => {
  const f = await setup();
  const row = await db.automationVariable.findUniqueOrThrow({
    where: { tenantId_identifier: { tenantId: f.tenant.id, identifier: 'cantidad' } },
  });
  await expect(
    mutateVariable(db, f.tenant.id, f.user.id, { action: 'create', variable: def('cantidad') }),
  ).rejects.toMatchObject({ status: 409 });
  const before = JSON.stringify(f.flow.published);
  await mutateVariable(db, f.tenant.id, f.user.id, {
    action: 'update',
    id: row.id,
    revision: row.revision,
    variable: { ...variableDefinition(row), name: 'Cantidad elegida', defaultValue: '5' },
  });
  expect(
    JSON.stringify(
      (await db.automationFlow.findUniqueOrThrow({ where: { id: f.flow.id } })).published,
    ),
  ).toBe(before);
  await expect(
    mutateVariable(db, f.tenant.id, f.user.id, {
      action: 'update',
      id: row.id,
      revision: row.revision,
      variable: def('cantidad', 'integer'),
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    mutateVariable(db, f.tenant.id, f.user.id, { action: 'delete', id: row.id, revision: 2 }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    mutateVariable(db, f.tenant.id, f.user.id, {
      action: 'update',
      id: row.id,
      revision: 2,
      variable: def('otra', 'decimal'),
    }),
  ).rejects.toMatchObject({ status: 409 });
  await mutateVariable(db, f.tenant.id, f.user.id, { action: 'create', variable: def('temporal') });
  const unused = await db.automationVariable.findUniqueOrThrow({
    where: { tenantId_identifier: { tenantId: f.tenant.id, identifier: 'temporal' } },
  });
  await mutateVariable(db, f.tenant.id, f.user.id, {
    action: 'delete',
    id: unused.id,
    revision: unused.revision,
  });
  expect(await db.automationVariable.findUnique({ where: { id: unused.id } })).toBeNull();
  const other = await fixture();
  await expect(
    mutateVariable(db, other.tenant.id, other.user.id, {
      action: 'delete',
      id: row.id,
      revision: 2,
    }),
  ).rejects.toMatchObject({ status: 404 });
  const api = `/api/workspaces/${f.tenant.id}/automation-variables`;
  expect((await other.api.get(api)).status()).toBe(403);
  expect(
    (
      await f.api.post(api, {
        headers: { origin: 'https://foreign.example' },
        data: { action: 'create', variable: def('origen') },
      })
    ).status(),
  ).toBe(403);
  await db.membership.update({
    where: { tenantId_userId: { tenantId: f.tenant.id, userId: f.user.id } },
    data: { role: 'MEMBER' },
  });
  expect((await f.api.get(api)).status()).toBe(200);
  expect(
    (await f.api.post(api, { data: { action: 'create', variable: def('permiso') } })).status(),
  ).toBe(403);
});
test('WhatsApp real del motor: persistencia, reinicio de proceso, corrección, idempotencia y clientes aislados', async () => {
  const f = await setup();
  let step = await reply(f, 'Hola');
  await processOutbound(db, step.message.id, async (_url, init) => {
    const body = JSON.parse(String(init.body));
    expect(body.interactive.body.text).toContain('red social');
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.dynamic.' + step.message.id }] }),
    };
  });
  step = await reply(f, '', step.snapshot.choices[0].id);
  step = await reply(f, '', step.snapshot.choices[0].id);
  step = await reply(f, '', step.snapshot.choices[2].id);
  expect(step.message.text).toContain('1000 de Seguidores para Instagram');
  const state = step.conversation.automationState as {
    variables: Record<string, string>;
    runId: string;
  };
  await processWebhook(db, step.record.id);
  expect(
    await db.message.count({ where: { automationSourceId: step.message.automationSourceId } }),
  ).toBe(1);
  const back = await event(f, '', step.snapshot.choices[1].id);
  await promisify(execFile)(
    process.execPath,
    ['--import', 'tsx', 'tests/helpers/process-flow-event.mts', back.record.id],
    { env: process.env },
  );
  const resumed = await db.message.findFirstOrThrow({
    where: { automationEventId: back.record.id },
  });
  const choices = (resumed.automationSnapshot as { choices: { id: string }[] }).choices;
  step = await reply(f, '', choices[1].id);
  expect(step.message.text).toContain('500 de Seguidores para Instagram');
  expect((step.conversation.automationState as typeof state).runId).toBe(state.runId);
  const final = await reply(f, '', step.snapshot.choices[0].id);
  expect(final.message.text).toContain('Confirmaste 500');
  expect((final.conversation.automationState as typeof state).variables.copia_servicio).toBe(
    'Seguidores',
  );
  const separate = await reply(f, 'Hola', undefined, '5491198765432');
  expect((separate.conversation.automationState as typeof state).variables).toEqual({});
  expect((separate.conversation.automationState as typeof state).runId).not.toBe(state.runId);
});
test('UI: catálogo, errores conservan formulario, insertar al cursor y simulación Sí/No', async ({
  page,
}, testInfo) => {
  const f = await fixture();
  await f.api.post('/api/workspaces/active', { data: { tenantId: f.tenant.id } });
  await page.context().addCookies((await f.api.storageState()).cookies);
  await page.goto('/dashboard/automatizaciones');
  await page.locator('.variable-manager > details > summary').click();
  await page.getByRole('button', { name: '+ Nueva variable', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nueva variable', exact: true });
  await dialog.getByLabel('Nombre descriptivo').fill('Nombre de prueba');
  await dialog.getByLabel('Identificador', { exact: true }).fill('nombre_prueba');
  await dialog.getByRole('button', { name: 'Guardar variable', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Editar nombre_prueba', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Editar variable', exact: true });
  await edit.getByLabel('Nombre descriptivo').fill('Nombre actualizado');
  let fail = true;
  await page.route('**/automation-variables', async (route) => {
    if (route.request().method() === 'POST' && fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Fallo de variable de prueba' }),
      });
    } else await route.continue();
  });
  await edit.getByRole('button', { name: 'Guardar variable', exact: true }).click();
  await expect(edit.getByRole('alert')).toContainText('Fallo');
  await expect(edit.getByLabel('Nombre descriptivo')).toHaveValue('Nombre actualizado');
  await edit.getByRole('button', { name: 'Guardar variable', exact: true }).click();
  await expect(edit).not.toBeVisible();
  await page.getByRole('button', { name: 'Duplicar nombre_prueba', exact: true }).click();
  await expect(dialog.getByLabel('Identificador', { exact: true })).toHaveValue(
    'nombre_prueba_copia1',
  );
  await dialog.getByRole('button', { name: 'Guardar variable', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Eliminar nombre_prueba_copia1', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Eliminar nombre_prueba_copia1', exact: true }),
  ).toHaveCount(0);

  await page
    .getByRole('button', { name: 'Cargar ejemplo de variables y confirmación', exact: true })
    .click();
  await expect(page.getByLabel('Título del paso')).toHaveValue('Red social');
  const message = page.getByLabel('Mensaje para el cliente', { exact: true });
  const original = await message.inputValue();
  await message.fill('Hola !');
  await message.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(5, 5));
  await page.getByRole('button', { name: '{ } Insertar variable', exact: true }).click();
  await page
    .locator('.variable-picker button')
    .filter({ has: page.locator('code', { hasText: '{{red_social}}' }) })
    .click();
  await expect(message).toHaveValue('Hola {{red_social}}!');
  await expect(message).toBeFocused();
  await message.fill('a'.repeat(900));
  await page.getByRole('button', { name: '{ } Insertar variable', exact: true }).click();
  await page
    .locator('.variable-picker button')
    .filter({ has: page.locator('code', { hasText: '{{red_social}}' }) })
    .click();
  await expect(page.getByRole('alert').filter({ hasText: '900 caracteres' })).toBeVisible();
  await expect(message).toHaveValue('a'.repeat(900));
  await page.getByRole('button', { name: '{ } Insertar variable', exact: true }).click();
  await message.fill(original);
  await page.getByRole('button', { name: '+ Nueva variable sin salir', exact: true }).click();
  await dialog.getByLabel('Nombre descriptivo').fill('Preferencia extra');
  await dialog.getByLabel('Identificador', { exact: true }).fill('preferencia_extra');
  await dialog.getByRole('button', { name: 'Guardar variable', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('combobox', { name: 'Guardar respuesta en variable', exact: true }),
  ).toHaveValue('preferencia_extra');
  await page
    .getByRole('combobox', { name: 'Guardar respuesta en variable', exact: true })
    .selectOption('red_social');
  await page.locator('.flow-node').filter({ hasText: 'Cantidad' }).first().click();
  const option = page
    .locator('.variable-option-extra')
    .filter({ hasText: 'Guardar valores de opción 3' });
  await option.locator('summary').click();
  await option.getByLabel('Valor a asignar').first().fill('16000');

  await page.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Borrador guardado.' })).toBeVisible();
  await page.getByRole('button', { name: 'Probar recorrido', exact: true }).click();
  const simulation = page.getByRole('dialog', { name: 'Probar recorrido', exact: true });
  for (const label of ['Instagram', 'Seguidores', '1000'])
    await simulation.getByRole('button', { name: label, exact: true }).click();
  await expect(simulation.getByText(/Importe de ejemplo: 16000 ARS/)).toBeVisible();
  for (const label of ['No, modificar', '500', 'Sí, continuar'])
    await simulation.getByRole('button', { name: label, exact: true }).click();
  await expect(simulation.getByText(/Confirmaste 500 de Seguidores para Instagram/)).toBeVisible();
  await page.screenshot({ path: `work/dynamic-variables-${testInfo.project.name}.png` });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Probar recorrido', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('captura tipada: rechaza valores inválidos, conserva los anteriores y evalúa condiciones numéricas', async () => {
  const f = await setup();
  const date = def('fecha_turno', 'date');
  await mutateVariable(db, f.tenant.id, f.user.id, { action: 'create', variable: date });
  const graph: FlowGraph = {
    schemaVersion: 2,
    name: 'Reserva genérica',
    start: 'cantidad',
    variables: [def('cantidad', 'integer'), date],
    nodes: [
      {
        id: 'cantidad',
        label: 'Cantidad',
        kind: 'capture',
        variable: 'cantidad',
        text: '¿Qué cantidad necesitás?',
        options: [{ id: 'siguiente', label: 'Continuar', next: 'fecha' }],
      },
      {
        id: 'fecha',
        label: 'Fecha',
        kind: 'capture',
        variable: 'fecha_turno',
        text: '¿Qué fecha? Usá AAAA-MM-DD.',
        options: [{ id: 'siguiente', label: 'Continuar', next: 'confirmar' }],
      },
      {
        id: 'confirmar',
        label: 'Confirmar',
        kind: 'menu',
        text: 'Confirmá {{cantidad}} para {{fecha_turno}}.',
        options: [
          { id: 'si', label: 'Sí', next: 'evaluar' },
          { id: 'no', label: 'No', next: 'cantidad' },
        ],
      },
      {
        id: 'evaluar',
        label: 'Evaluar',
        kind: 'condition',
        text: '',
        variable: 'cantidad',
        operator: 'gte',
        value: '1000',
        options: [
          { id: 'si', label: 'Sí', next: 'grande' },
          { id: 'no', label: 'No', next: 'chico' },
        ],
      },
      {
        id: 'grande',
        label: 'Grande',
        kind: 'message',
        text: 'Revisaremos {{cantidad}} para {{fecha_turno}} con el equipo.',
        options: [],
      },
      {
        id: 'chico',
        label: 'Chico',
        kind: 'message',
        text: 'Confirmaste {{cantidad}} para {{fecha_turno}}.',
        options: [],
      },
    ],
  };
  expect(flowIssues(graph)).toEqual([]);
  const saved = await mutateFlow(db, f.tenant.id, f.user.id, f.account.id, {
    action: 'save',
    revision: f.flow.revision,
    graph,
  });
  await mutateFlow(db, f.tenant.id, f.user.id, f.account.id, {
    action: 'publish',
    revision: saved.revision,
  });
  await reply(f, 'Hola');
  await reply(f, '1000');
  let step = await reply(f, '2028-02-29');
  step = await reply(f, '', step.snapshot.choices[1].id);
  const invalid = await reply(f, 'No es un número');
  expect(invalid.message.text).toContain('entero');
  expect(invalid.conversation.automationState).toMatchObject({
    variables: { cantidad: '1000', fecha_turno: '2028-02-29' },
  });
  await reply(f, '500');
  const badDate = await reply(f, '2026-02-29');
  expect(badDate.message.text).toContain('fecha real');
  expect(badDate.conversation.automationState).toMatchObject({
    variables: { cantidad: '500', fecha_turno: '2028-02-29' },
  });
  step = await reply(f, '2028-03-01');
  step = await reply(f, '', step.snapshot.choices[0].id);
  expect(step.message.text).toContain('Confirmaste 500 para 2028-03-01');
  await processOutbound(db, step.message.id, async (_url, init) => {
    expect(JSON.parse(String(init.body)).text.body).toContain('Confirmaste 500 para 2028-03-01');
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.typed.' + step.message.id }] }),
    };
  });
});

test('respuestas simultáneas: una opción anterior no pisa valores ya guardados', async () => {
  const f = await setup();
  let step = await reply(f, 'Hola');
  step = await reply(f, '', step.snapshot.choices[0].id);
  step = await reply(f, '', step.snapshot.choices[0].id);
  const timestamp = Math.floor(Date.now() / 1000);
  const a = await event(f, '', step.snapshot.choices[0].id, '5491112345678', timestamp),
    b = await event(f, '', step.snapshot.choices[2].id, '5491112345678', timestamp);
  await Promise.all([processWebhook(db, a.record.id), processWebhook(db, b.record.id)]);
  const conversation = await db.conversation.findUniqueOrThrow({
    where: { id: step.conversation.id },
  });
  const values = (conversation.automationState as { variables: Record<string, string> }).variables;
  expect(values.red_social).toBe('Instagram');
  expect(values.servicio).toBe('Seguidores');
  expect(['100', '1000']).toContain(values.cantidad);
  expect(values.precio).toBe(values.cantidad === '100' ? '1500' : '15400');
  expect(
    await db.message.count({ where: { automationEventId: { in: [a.record.id, b.record.id] } } }),
  ).toBe(2);
});
