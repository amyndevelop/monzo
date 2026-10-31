import { z } from 'zod';
const key = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/);
export const flowSchema = z
  .object({
    name: z.string().trim().max(80),
    start: z.string().max(40),
    nodes: z
      .array(
        z
          .object({
            id: key,
            label: z.string().trim().max(60),
            kind: z.enum(['menu', 'message', 'handoff', 'capture', 'condition']),
            text: z.string().trim().max(900),
            variable: z.string().max(40).optional(),
            operator: z.enum(['equals', 'contains', 'exists']).optional(),
            value: z.string().trim().max(120).optional(),
            options: z
              .array(
                z
                  .object({ id: key, label: z.string().trim().max(20), next: z.string().max(40) })
                  .strict(),
              )
              .max(10),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export type FlowGraph = z.infer<typeof flowSchema>;
export type FlowNode = FlowGraph['nodes'][number];
export function flowIssues(graph: FlowGraph) {
  const issues: string[] = [];
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!graph.name) issues.push('Escribí un nombre para el flujo.');
  if (!nodes.has(graph.start)) issues.push('Elegí un paso inicial.');
  if (nodes.size !== graph.nodes.length) issues.push('Hay identificadores de pasos repetidos.');
  for (const node of graph.nodes) {
    const name = node.label || node.id;
    if (!node.label || (node.kind !== 'condition' && !node.text))
      issues.push(`${name}: completá título y mensaje.`);
    if (node.kind === 'menu') {
      if (!node.options.length) issues.push(`${name}: agregá al menos una opción.`);
      if (
        new Set(node.options.map((o) => o.id)).size !== node.options.length ||
        new Set(node.options.map((o) => normalize(o.label))).size !== node.options.length
      )
        issues.push(`${name}: las opciones deben ser distintas.`);
      for (const option of node.options)
        if (!option.label || !nodes.has(option.next))
          issues.push(`${name}: completá el texto y destino de cada opción.`);
    } else if (node.kind === 'capture' || node.kind === 'condition') {
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(node.variable ?? ''))
        issues.push(`${name}: usá una variable como nombre o tipo_consulta.`);
      const expected = node.kind === 'capture' ? 1 : 2;
      if (node.options.length !== expected || node.options.some((o) => !nodes.has(o.next)))
        issues.push(`${name}: completá ${expected} destinos.`);
      if (
        node.kind === 'condition' &&
        (!node.operator || (node.operator !== 'exists' && !node.value))
      )
        issues.push(`${name}: completá la condición.`);
    } else if (node.options.length) issues.push(`${name}: un paso final no puede tener opciones.`);
  }
  const visited = new Set<string>();
  const stack = new Set<string>();
  let cycle = false;
  function visit(id: string) {
    if (stack.has(id)) {
      cycle = true;
      return;
    }
    if (visited.has(id) || !nodes.has(id)) return;
    visited.add(id);
    stack.add(id);
    for (const o of nodes.get(id)!.options) visit(o.next);
    stack.delete(id);
  }
  visit(graph.start);
  if (cycle) issues.push('El árbol tiene un ciclo. Conectá las opciones hacia pasos siguientes.');
  if (visited.size !== nodes.size)
    issues.push('Hay pasos sin conectar desde el inicio. Conectalos o eliminalos.');
  // Intersect predecessor outputs; evaluate shared branches once per node.
  const outputs = new Map<string, Set<string>>();
  function check(id: string): Set<string> {
    if (outputs.has(id)) return outputs.get(id)!;
    const node = nodes.get(id)!;
    const parents = graph.nodes.filter(
      (n) => visited.has(n.id) && n.options.some((o) => o.next === id),
    );
    const sources = id === graph.start ? [] : parents.map((n) => check(n.id));
    const available = sources.length
      ? new Set([...sources[0]].filter((v) => sources.every((s) => s.has(v))))
      : new Set<string>();
    const reads =
      node.kind === 'condition'
        ? [node.variable ?? '']
        : [...node.text.matchAll(/\{\{([^{}]+)\}\}/g)].map((m) => m[1]);
    for (const variable of reads)
      if (!available.has(variable))
        issues.push(
          `${node.label}: la variable ${variable} debe guardarse antes en todos los caminos.`,
        );
    if (node.kind === 'capture' && node.variable) available.add(node.variable);
    outputs.set(id, available);
    return available;
  }
  if (!cycle && nodes.size === graph.nodes.length) for (const id of visited) check(id);
  return [...new Set(issues)];
}
export const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
export const exampleFlow: FlowGraph = {
  name: 'Atención inicial',
  start: 'inicio',
  nodes: [
    {
      id: 'inicio',
      label: 'Bienvenida',
      kind: 'menu',
      text: '¡Hola! ¿En qué podemos ayudarte?',
      options: [
        { id: 'horarios', label: 'Consultar horarios', next: 'horarios' },
        { id: 'equipo', label: 'Hablar con alguien', next: 'equipo' },
      ],
    },
    {
      id: 'horarios',
      label: 'Horarios',
      kind: 'message',
      text: 'Configurá acá los horarios de tu negocio antes de publicar.',
      options: [],
    },
    {
      id: 'equipo',
      label: 'Atención humana',
      kind: 'handoff',
      text: 'Un integrante del equipo continuará la atención por acá.',
      options: [],
    },
  ],
};
export const stateSchema = z.object({
  flowId: z.string(),
  version: z.number().int(),
  nodeId: z.string(),
  status: z.enum(['waiting', 'completed', 'handoff', 'blocked']),
  misses: z.number().int().min(0),
  reason: z.string().optional(),
  variables: z.record(z.string(), z.string().max(120)).optional(),
});
export const snapshotSchema = z.object({
  version: z.literal(1),
  flowId: z.string(),
  publishedVersion: z.number().int(),
  generation: z.number().int(),
  nodeId: key,
  kind: z.enum(['menu', 'message', 'handoff', 'capture', 'condition']),
  text: z.string().max(1024),
  choices: z
    .array(z.object({ id: z.string().min(1).max(200), label: z.string().min(1).max(20) }))
    .max(10),
});
export type FlowSnapshot = z.infer<typeof snapshotSchema>;
export function choiceId(
  flowId: string,
  version: number,
  generation: number,
  nodeId: string,
  optionId: string,
) {
  return `mz:${flowId}:${version}:${generation}:${nodeId}:${optionId}`;
}
export function interactivePayload(snapshot: FlowSnapshot) {
  if (!snapshot.choices.length) throw new Error('INVALID_FLOW_MENU');
  return snapshot.choices.length <= 3
    ? {
        type: 'button',
        body: { text: snapshot.text },
        action: {
          buttons: snapshot.choices.map((o) => ({
            type: 'reply',
            reply: { id: o.id, title: o.label },
          })),
        },
      }
    : {
        type: 'list',
        body: { text: snapshot.text },
        action: {
          button: 'Ver opciones',
          sections: [
            {
              title: 'Elegí una opción',
              rows: snapshot.choices.map((o) => ({ id: o.id, title: o.label })),
            },
          ],
        },
      };
}

export type FlowVariables = Record<string, string>;
export function renderFlowText(text: string, variables: FlowVariables) {
  return text.replace(/\{\{([^{}]+)\}\}/g, (_, key: string) => variables[key] ?? '').slice(0, 900);
}
export function resolveConditions(
  graph: FlowGraph,
  id: string,
  variables: FlowVariables,
): FlowNode {
  let node = graph.nodes.find((n) => n.id === id);
  const visited = new Set<string>();
  while (node?.kind === 'condition') {
    if (visited.has(node.id)) throw new Error('INVALID_FLOW_CONDITION');
    visited.add(node.id);
    const actual = normalize(variables[node.variable ?? ''] ?? '');
    const expected = normalize(node.value ?? '');
    const matches =
      node.operator === 'exists'
        ? Boolean(actual)
        : node.operator === 'contains'
          ? actual.includes(expected)
          : actual === expected;
    node = graph.nodes.find((n) => n.id === node!.options[matches ? 0 : 1]?.next);
  }
  if (!node) throw new Error('INVALID_FLOW_DESTINATION');
  return node;
}
export function captureAnswer(text: string, choice?: string) {
  const value = text.trim();
  return !choice && value.length > 0 && value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null;
}
