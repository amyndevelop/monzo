import { z } from 'zod';
import {
  variableSchema,
  assignmentSchema,
  identifierSchema,
  allowedOperators,
  parseValue,
  type VariableDefinition,
} from './variables';
const key = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/);
export const flowSchema = z
  .object({
    schemaVersion: z.literal(2).optional(),
    name: z.string().trim().max(80),
    start: z.string().max(40),
    variables: z.array(variableSchema).max(100).optional(),
    nodes: z
      .array(
        z
          .object({
            id: key,
            label: z.string().trim().max(60),
            kind: z.enum(['menu', 'message', 'handoff', 'capture', 'condition', 'assign']),
            text: z.string().trim().max(900),
            variable: z.string().max(40).optional(),
            operator: z
              .enum([
                'equals',
                'not_equals',
                'gt',
                'lt',
                'gte',
                'lte',
                'contains',
                'not_contains',
                'empty',
                'exists',
                'true',
                'false',
              ])
              .optional(),
            value: z.string().trim().max(120).optional(),
            assignments: z.array(assignmentSchema).max(10).optional(),
            options: z
              .array(
                z
                  .object({
                    id: key,
                    label: z.string().trim().max(20),
                    next: z.string().max(40),
                    value: z.string().max(120).optional(),
                    assignments: z.array(assignmentSchema).max(5).optional(),
                  })
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
export const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
export function effectiveVariables(graph: FlowGraph): VariableDefinition[] {
  if (graph.variables) return graph.variables;
  return [
    ...new Set(
      graph.nodes
        .filter((n) => n.kind === 'capture')
        .map((n) => n.variable)
        .filter((v): v is string => identifierSchema.safeParse(v).success),
    ),
  ].map((identifier) => ({
    identifier,
    name: identifier,
    type: 'text',
    scope: 'execution',
    description: 'Variable de un flujo anterior',
    defaultValue: null,
    currency: 'ARS',
  }));
}
export function variableReferences(graph: FlowGraph, identifier: string) {
  return graph.nodes
    .filter(
      (n) =>
        (['menu', 'capture', 'condition'].includes(n.kind) && n.variable === identifier) ||
        [
          ...(['menu', 'capture', 'message', 'handoff'].includes(n.kind) ? n.text : '').matchAll(
            /\{\{([^{}]+)\}\}/g,
          ),
        ].some((m) => m[1] === identifier) ||
        [...(n.assignments ?? []), ...n.options.flatMap((o) => o.assignments ?? [])].some(
          (a) => a.variable === identifier || (a.operation === 'copy' && a.value === identifier),
        ),
    )
    .map((n) => n.label || n.id);
}
export function flowIssues(graph: FlowGraph) {
  const issues: string[] = [];
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const defs = effectiveVariables(graph);
  const declared = new Map(defs.map((d) => [d.identifier, d]));
  if (!graph.name) issues.push('Escribí un nombre para el flujo.');
  if (!nodes.has(graph.start)) issues.push('Elegí un paso inicial.');
  if (nodes.size !== graph.nodes.length) issues.push('Hay identificadores de pasos repetidos.');
  if (declared.size !== defs.length) issues.push('Hay identificadores de variables repetidos.');
  for (const d of defs)
    if (d.defaultValue !== null) {
      try {
        parseValue(d, d.defaultValue);
      } catch (error) {
        issues.push(
          `${d.name}: ${error instanceof Error ? error.message : 'Valor predeterminado inválido.'}`,
        );
      }
    }
  function assignmentIssues(items: NonNullable<FlowNode['assignments']>, label: string) {
    for (const a of items) {
      const def = declared.get(a.variable);
      if (!def) {
        issues.push(`${label}: variable inexistente ${a.variable}.`);
        continue;
      }
      try {
        if (a.operation === 'set') parseValue(def, a.value);
        if (a.operation === 'copy' && !declared.has(a.value))
          throw new Error('La variable de origen no existe.');
      } catch (error) {
        issues.push(`${label}: ${error instanceof Error ? error.message : 'Asignación inválida.'}`);
      }
    }
  }
  for (const n of graph.nodes) {
    const name = n.label || n.id;
    if (!n.label || (!['condition', 'assign'].includes(n.kind) && !n.text))
      issues.push(`${name}: completá título y mensaje.`);
    if (n.kind === 'menu') {
      if (!n.options.length) issues.push(`${name}: agregá al menos una opción.`);
      if (
        new Set(n.options.map((o) => o.id)).size !== n.options.length ||
        new Set(n.options.map((o) => normalize(o.label))).size !== n.options.length
      )
        issues.push(`${name}: las opciones deben ser distintas.`);
      for (const o of n.options) {
        if (!o.label || !nodes.has(o.next))
          issues.push(`${name}: completá el texto y destino de cada opción.`);
        assignmentIssues(o.assignments ?? [], name);
        if (n.variable) {
          const d = declared.get(n.variable);
          try {
            if (!d) throw new Error(`Variable inexistente ${n.variable}.`);
            parseValue(d, o.value ?? o.label);
          } catch (e) {
            issues.push(`${name}: ${e instanceof Error ? e.message : 'Valor inválido.'}`);
          }
        }
      }
    } else if (['capture', 'condition', 'assign'].includes(n.kind)) {
      const expected = n.kind === 'condition' ? 2 : 1;
      if (n.options.length !== expected || n.options.some((o) => !nodes.has(o.next)))
        issues.push(`${name}: completá ${expected} destinos.`);
    } else if (n.options.length) issues.push(`${name}: un paso final no puede tener opciones.`);
    if (n.kind === 'capture' || n.kind === 'condition' || (n.kind === 'menu' && n.variable)) {
      const def = declared.get(n.variable ?? '');
      if (!def)
        issues.push(
          `${name}: la variable ${n.variable ?? ''} debe guardarse antes o crearse en Variables.`,
        );
      if (n.kind === 'condition' && def) {
        if (!n.operator || !allowedOperators(def.type).includes(n.operator))
          issues.push(`${name}: elegí una comparación compatible.`);
        else if (!['exists', 'empty', 'true', 'false'].includes(n.operator)) {
          try {
            parseValue(
              ['contains', 'not_contains'].includes(n.operator) ? { ...def, type: 'text' } : def,
              n.value ?? '',
            );
          } catch (e) {
            issues.push(`${name}: ${e instanceof Error ? e.message : 'Completá la condición.'}`);
          }
        }
      }
    }
    if (n.kind === 'assign') {
      if (!n.assignments?.length) issues.push(`${name}: agregá al menos una asignación.`);
      assignmentIssues(n.assignments ?? [], name);
    }
    if (n.kind !== 'assign' && n.assignments?.length)
      issues.push(`${name}: las asignaciones del paso requieren Asignar variable.`);
    if (n.kind !== 'menu' && n.options.some((o) => o.assignments?.length || o.value !== undefined))
      issues.push(`${name}: las asignaciones de opciones requieren una pregunta con opciones.`);
    if (n.options.some((o) => o.next === n.id))
      issues.push(
        `${name}: tiene un ciclo al mismo paso. Volvé a otro paso de pregunta para corregir datos.`,
      );
    for (const m of n.text.matchAll(/\{\{([^{}]+)\}\}/g))
      if (!declared.has(m[1])) issues.push(`${name}: variable inexistente ${m[1]}.`);
  }
  const reachable = new Set<string>();
  function visit(id: string) {
    if (reachable.has(id) || !nodes.has(id)) return;
    reachable.add(id);
    for (const o of nodes.get(id)!.options) visit(o.next);
  }
  visit(graph.start);
  if (reachable.size !== nodes.size)
    issues.push('Hay pasos sin conectar desde el inicio. Conectalos o eliminalos.');
  // Cycles are permitted only if an actual customer question interrupts automatic execution.
  const visited = new Set<string>(),
    stack = new Set<string>();
  function automatic(id: string): boolean {
    const n = nodes.get(id);
    if (!n || !['assign', 'condition'].includes(n.kind)) return false;
    if (stack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    stack.add(id);
    const cycle = n.options.some((o) => automatic(o.next));
    stack.delete(id);
    return cycle;
  }
  if (graph.nodes.some((n) => automatic(n.id)))
    issues.push('Hay un ciclo de pasos automáticos sin una respuesta del cliente.');
  if (nodes.size !== graph.nodes.length) return [...new Set(issues)];
  // Definite-assignment fixed point also handles correction paths without exponential traversal.
  const all = new Set(declared.keys()),
    initial = new Set(defs.filter((d) => d.defaultValue !== null).map((d) => d.identifier));
  const available = new Map(
    [...reachable].map((id) => [id, id === graph.start ? new Set(initial) : new Set(all)]),
  );
  function effects(n: FlowNode, option: FlowNode['options'][number], input: Set<string>) {
    const next = new Set(input);
    if (n.kind === 'capture' && n.variable) next.add(n.variable);
    if (n.kind === 'menu' && n.variable) next.add(n.variable);
    if (n.kind === 'condition' && n.variable) {
      const index = n.options.indexOf(option);
      if ((n.operator === 'empty' && index === 1) || (n.operator !== 'empty' && index === 0))
        next.add(n.variable);
    }
    for (const a of [
      ...(n.kind === 'assign' ? (n.assignments ?? []) : []),
      ...(n.kind === 'menu' ? (option.assignments ?? []) : []),
    ]) {
      if (a.operation === 'clear') next.delete(a.variable);
      else if (a.operation !== 'copy' || next.has(a.value)) next.add(a.variable);
      else next.delete(a.variable);
    }
    return next;
  }
  for (let iteration = 0; iteration < 3100; iteration++) {
    let changed = false;
    for (const id of reachable) {
      if (id === graph.start) continue;
      const inputs = graph.nodes
        .filter((n) => reachable.has(n.id))
        .flatMap((n) =>
          n.options
            .filter((o) => o.next === id)
            .map((o) => effects(n, o, available.get(n.id) ?? new Set())),
        );
      const next = inputs.length
        ? new Set([...inputs[0]].filter((v) => inputs.every((s) => s.has(v))))
        : new Set<string>();
      const previous = available.get(id)!;
      if (next.size !== previous.size || [...next].some((v) => !previous.has(v))) {
        available.set(id, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const n of graph.nodes) {
    const have = available.get(n.id) ?? new Set<string>();
    const reads = [
      ...(['menu', 'capture', 'message', 'handoff'].includes(n.kind) ? n.text : '').matchAll(
        /\{\{([^{}]+)\}\}/g,
      ),
    ].map((m) => m[1]);
    if (n.kind === 'condition' && !['exists', 'empty'].includes(n.operator ?? ''))
      reads.push(n.variable ?? '');
    for (const v of reads)
      if (!have.has(v))
        issues.push(`${n.label}: la variable ${v} debe guardarse antes en todos los caminos.`);
    for (const list of [
      n.kind === 'assign' ? (n.assignments ?? []) : [],
      ...n.options.map((o) => o.assignments ?? []),
    ]) {
      const current = new Set(have);
      if (n.kind === 'menu' && n.variable) current.add(n.variable);
      for (const a of list) {
        if (a.operation === 'copy' && !current.has(a.value))
          issues.push(`${n.label}: la variable ${a.value} debe guardarse antes de copiar.`);
        if (a.operation === 'clear') current.delete(a.variable);
        else current.add(a.variable);
      }
    }
  }
  return [...new Set(issues)];
}
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
  variables: z.record(identifierSchema, z.string().max(1024)).optional(),
  turns: z.number().int().min(0).optional(),
  runId: z.string().optional(),
});
export const snapshotSchema = z.object({
  version: z.literal(1),
  flowId: z.string(),
  publishedVersion: z.number().int(),
  generation: z.number().int(),
  nodeId: key,
  kind: z.enum(['menu', 'message', 'handoff', 'capture', 'condition', 'assign']),
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
export function captureAnswer(text: string, choice?: string) {
  const value = text.trim();
  return !choice && value.length > 0 && value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null;
}
