import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readServicePrices, createServiceMenu } from '../src/modules/automations/service-menu';
import { flowIssues } from '../src/modules/automations/definition';
import { advanceFlow } from '../src/modules/automations/engine';
const header = 'categoria;servicio;cantidad;precio;moneda\n';
const list =
  header +
  'Red A;Plan simple;100;990;ARS\nRed A;Plan simple;250;2160;ARS\nRed B;Plan premium;100;12,50;ARS\n';
test('servicios: CSV de Excel, BOM, comillas y decimales conserva importes de paquetes', () => {
  const rows = readServicePrices(
    '\uFEFF' + list.replace('Red B;Plan premium', '"Red B";"Plan ""premium"""'),
  );
  assert.equal(rows.length, 3);
  assert.equal(rows[2].service, 'Plan "premium"');
  assert.equal(rows[2].amount, '12.50');
  assert.equal(rows[1].quantity, 250);
  const comma = readServicePrices(
    'categoria,servicio,cantidad,precio,moneda\nRed A,Plan,10,25.50,USD',
  );
  assert.equal(comma[0].amount, '25.50');
});
test('servicios: categoría, servicio, lista de precios y asesor usan el motor real sin ciclos', () => {
  const graph = createServiceMenu(readServicePrices(list));
  assert.deepEqual(flowIssues(graph), []);
  assert.equal(graph.nodes.length, 6);
  const root = advanceFlow(graph, null, { text: 'Hola' });
  assert.equal(root.node.options[0].label, 'Red A');
  const category = advanceFlow(graph, root, { text: '1' });
  assert.equal(category.node.options[0].label, 'Plan simple');
  const prices = advanceFlow(graph, category, { text: '1' });
  assert.match(prices.text, /100:.*990.*ARS/);
  assert.match(prices.text, /250:.*2\.160.*ARS/);
  assert.equal(prices.node.kind, 'menu');
  const handoff = advanceFlow(graph, prices, { text: '1' });
  assert.equal(handoff.status, 'handoff');
  const reset = advanceFlow(graph, prices, { text: 'MENÚ' });
  assert.equal(reset.node.id, graph.start);
});
test('servicios: importes ambiguos, cantidades, campos incompletos y duplicados se rechazan sin truncar', () => {
  for (const row of [
    'A;B;100;2.160;ARS',
    'A;B;1.000;2160;ARS',
    'A;B;100;0;ARS',
    'A;B;100;-1;ARS',
    'A;B;100;1.999;ARS',
    'A;B;100;990',
    'A;B;100;990;ARS;extra',
    'A;B;100;990;pesos',
  ])
    assert.throws(() => readServicePrices(header + row));
  assert.throws(() => readServicePrices(header + 'A;B;100;10;ARS\na;b;100;20;ARS'), /ya figura/);
  assert.throws(
    () => readServicePrices(header + 'A;B;100;10;ARS\nA;B;250;20;USD'),
    /una sola moneda/,
  );
  assert.throws(() => readServicePrices(header + '"A;B;100;10;ARS'), /comillas/);
  assert.throws(() => readServicePrices(header + '"A"x;B;100;10;ARS'), /comillas/);
});
test('servicios: rechaza interpolación de variables no declaradas, desbordes de mensajes y límites del motor', () => {
  assert.throws(() => createServiceMenu(readServicePrices(list), 'Hola {{cliente}}'));
  assert.throws(() => readServicePrices(header + 'A;{{precio}};100;10;ARS'));
  assert.throws(() => readServicePrices(header + 'A'.repeat(131073)), /128 KB/);
  const many = readServicePrices(
    header + Array.from({ length: 40 }, (_, i) => `A;B;${10000000 + i};99999999999;ARS`).join('\n'),
  );
  assert.throws(() => createServiceMenu(many), /largo/);
  const categories = readServicePrices(
    header + Array.from({ length: 10 }, (_, i) => `Red ${i};Plan;100;10;ARS`).join('\n'),
  );
  assert.throws(() => createServiceMenu(categories), /nueve categorías/);
});
