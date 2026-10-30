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
            kind: z.enum(['menu', 'message', 'handoff']),
            text: z.string().trim().max(900),
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
    if (!node.label || !node.text) issues.push(`${name}: completá título y mensaje.`);
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
  return issues;
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
});
export const snapshotSchema = z.object({
  version: z.literal(1),
  flowId: z.string(),
  publishedVersion: z.number().int(),
  generation: z.number().int(),
  nodeId: key,
  kind: z.enum(['menu', 'message', 'handoff']),
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
