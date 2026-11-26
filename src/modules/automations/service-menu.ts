import { flowIssues, flowSchema, type FlowGraph, type FlowNode } from './definition';

export type ServicePrice = {
  category: string;
  service: string;
  quantity: number;
  amount: string;
  currency: string;
};
export class ServiceMenuError extends Error {}
const normalize = (v: string) => v.normalize('NFKC').trim();

// Delimited text only. No spreadsheet formulas, HTML or code are evaluated.
export function readServicePrices(text: string): ServicePrice[] {
  if (text.length > 131072) throw new ServiceMenuError('La lista debe ocupar hasta 128 KB.');
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const delimiter = first.includes(';') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
    } else if (c === '"' && !field && !closed) quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
      closed = false;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      field = '';
      closed = false;
    } else {
      if (closed && c.trim()) throw new ServiceMenuError('Revisá las comillas de la lista CSV.');
      if (!closed) field += c;
    }
    if (rows.length > 250 || row.length > 5)
      throw new ServiceMenuError('Usá hasta 250 paquetes y las cinco columnas indicadas.');
  }
  if (quoted) throw new ServiceMenuError('Quedó un campo con comillas sin cerrar.');
  row.push(field);
  if (row.some((v) => v.trim())) rows.push(row);
  if (
    rows
      .shift()
      ?.map((v) => normalize(v).toLowerCase())
      .join(',') !== 'categoria,servicio,cantidad,precio,moneda'
  )
    throw new ServiceMenuError(
      'La primera fila debe ser: categoria;servicio;cantidad;precio;moneda.',
    );
  if (!rows.length || rows.length > 250)
    throw new ServiceMenuError('Cargá entre 1 y 250 paquetes.');
  const keys = new Set<string>();
  const prices = rows.map((cells, i) => {
    const line = i + 2;
    if (cells.length !== 5)
      throw new ServiceMenuError(`Fila ${line}: completá las cinco columnas.`);
    const [category, service, qty, price, currency] = cells.map(normalize);
    if ([category, service].some((v) => !v || v.length > 20 || /[\p{Cc}\p{Cf}{}]/u.test(v)))
      throw new ServiceMenuError(
        `Fila ${line}: categoría y servicio deben tener entre 1 y 20 caracteres, sin saltos de línea ni llaves.`,
      );
    if (!/^[1-9][0-9]{0,8}$/.test(qty))
      throw new ServiceMenuError(
        `Fila ${line}: ingresá una cantidad entera, sin puntos ni separadores.`,
      );
    const amount = price.replace(',', '.');
    if (!/^(?:0|[1-9][0-9]{0,10})(?:\.[0-9]{1,2})?$/.test(amount) || Number(amount) <= 0)
      throw new ServiceMenuError(
        `Fila ${line}: ingresá el precio del paquete, sin símbolo ni separadores de miles; hasta dos decimales.`,
      );
    if (!/^[A-Z]{3}$/.test(currency))
      throw new ServiceMenuError(`Fila ${line}: usá una moneda de tres letras, como ARS o USD.`);
    const key = JSON.stringify([
      category.toLocaleLowerCase('es'),
      service.toLocaleLowerCase('es'),
      Number(qty),
    ]);
    if (keys.has(key))
      throw new ServiceMenuError(`Fila ${line}: ese paquete ya figura en la lista.`);
    keys.add(key);
    return { category, service, quantity: Number(qty), amount, currency };
  });
  if (new Set(prices.map((p) => p.currency)).size !== 1)
    throw new ServiceMenuError(
      'Usá una sola moneda por menú. Los importes no se convierten automáticamente.',
    );
  return prices;
}

export function createServiceMenu(
  prices: ServicePrice[],
  welcome = '¡Hola! Gracias por escribirnos. Elegí qué servicios querés consultar.',
): FlowGraph {
  if (!prices.length || prices.length > 250)
    throw new ServiceMenuError('Cargá entre 1 y 250 paquetes.');
  // The public generator also validates callers that did not use the CSV reader.
  const csv =
    'categoria;servicio;cantidad;precio;moneda\n' +
    prices
      .map((p) =>
        [p.category, p.service, p.quantity, p.amount, p.currency]
          .map((v) => '"' + String(v).replaceAll('"', '""') + '"')
          .join(';'),
      )
      .join('\n');
  prices = readServicePrices(csv);
  welcome = welcome.trim();
  if (!welcome || welcome.length > 600 || /[\p{Cc}\p{Cf}{}]/u.test(welcome))
    throw new ServiceMenuError(
      'Escribí una bienvenida de hasta 600 caracteres, sin llaves ni saltos de línea.',
    );
  const categories = [...new Set(prices.map((p) => p.category))];
  if (categories.length > 9)
    throw new ServiceMenuError(
      'El menú admite hasta nueve categorías y una opción para hablar con el equipo.',
    );
  const nodes: FlowNode[] = [
    { id: 'servicios', label: 'Servicios y precios', kind: 'menu', text: welcome, options: [] },
  ];
  const handoff = { id: 'asesor', label: 'Hablar con asesor', next: 'asesor' };
  categories.forEach((category, c) => {
    const id = `categoria_${c + 1}`;
    nodes[0].options.push({ id, label: category, next: id });
    const services = [
      ...new Set(prices.filter((p) => p.category === category).map((p) => p.service)),
    ];
    if (services.length > 9)
      throw new ServiceMenuError(`${category}: usá hasta nueve servicios por categoría.`);
    const menu: FlowNode = {
      id,
      label: category,
      kind: 'menu',
      text: `¿Qué servicio de ${category} querés consultar?`,
      options: [],
    };
    nodes.push(menu);
    services.forEach((service, s) => {
      const serviceId = `${id}_servicio_${s + 1}`;
      menu.options.push({ id: serviceId, label: service, next: serviceId });
      const items = prices
        .filter((p) => p.category === category && p.service === service)
        .sort((a, b) => a.quantity - b.quantity);
      const text =
        `${category} · ${service}\n\n` +
        items
          .map(
            (p) =>
              `${p.quantity.toLocaleString('es-AR')}: ${new Intl.NumberFormat('es-AR', { style: 'currency', currency: p.currency, maximumFractionDigits: 2 }).format(Number(p.amount))} ${p.currency}`,
          )
          .join('\n') +
        '\n\nPrecios por paquete. Para continuar con el equipo, elegí Consultar compra. Escribí MENÚ para volver al inicio.';
      if (text.length > 900)
        throw new ServiceMenuError(
          `${category} · ${service}: la lista supera el largo de un mensaje. Dividila en servicios más específicos.`,
        );
      nodes.push({
        id: serviceId,
        label: `${category} · ${service}`.slice(0, 60),
        kind: 'menu',
        text,
        options: [{ id: 'consulta', label: 'Consultar compra', next: 'asesor' }],
      });
    });
    menu.options.push({ ...handoff });
  });
  nodes[0].options.push({ ...handoff });
  nodes.push({
    id: 'asesor',
    label: 'Atención humana',
    kind: 'handoff',
    text: 'Te derivamos al equipo para continuar con tu consulta. Podés dejar tu mensaje por acá.',
    options: [],
  });
  if (nodes.length > 30)
    throw new ServiceMenuError(
      'Esta lista necesita más de 30 pasos. Agrupá los servicios antes de importarla.',
    );
  const graph = flowSchema.parse({
    schemaVersion: 2,
    name: 'Servicios y precios',
    start: 'servicios',
    variables: [],
    nodes,
  });
  const issues = flowIssues(graph);
  if (issues.length) throw new ServiceMenuError(issues[0]);
  return graph;
}
