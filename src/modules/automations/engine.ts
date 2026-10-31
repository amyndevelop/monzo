import { effectiveVariables, normalize, type FlowGraph, type FlowNode } from './definition';
import {
  applyAssignments,
  compareValue,
  defaults,
  formatValue,
  parseValue,
  type Values,
} from './variables';
export type EngineState = {
  nodeId: string;
  status: 'waiting' | 'completed' | 'handoff' | 'blocked';
  misses: number;
  variables?: Values;
  turns?: number;
  runId?: string;
  reason?: string;
};
export type EngineResult = EngineState & {
  node: FlowNode;
  text: string;
  variables: Values;
  turns: number;
  runId: string;
};
export function interpolate(graph: FlowGraph, text: string, values: Values, preview = false) {
  const defs = effectiveVariables(graph);
  const result = text.replace(/\{\{([^{}]+)\}\}/g, (_, key: string) => {
    const def = defs.find((d) => d.identifier === key),
      value = values[key];
    if (!def || value === undefined || value === '') {
      if (preview) return `[sin definir: ${key}]`;
      throw new Error(`Falta un valor para ${key}.`);
    }
    return formatValue(def, parseValue(def, value));
  });
  if (result.length > 900 && !preview)
    throw new Error('El mensaje con variables supera los 900 caracteres.');
  return result;
}
export function advanceFlow(
  graph: FlowGraph,
  previous: EngineState | null,
  input: { text: string; optionId?: string; invalidChoice?: boolean },
): EngineResult {
  const defs = effectiveVariables(graph);
  const restart =
    !input.optionId && !input.invalidChoice && ['menu', 'inicio'].includes(normalize(input.text));
  const state = restart ? null : previous;
  let values = state ? { ...state.variables } : defaults(defs);
  const turns = (state?.turns ?? 0) + 1,
    runId = state?.runId ?? crypto.randomUUID();
  let node = graph.nodes.find((n) => n.id === (state?.nodeId ?? graph.start));
  let misses = 0,
    hint = '';
  function finish(final: FlowNode, status: EngineState['status'], reason?: string): EngineResult {
    return {
      node: final,
      nodeId: final.id,
      status,
      variables: values,
      misses,
      turns,
      runId,
      reason,
      text: hint + interpolate(graph, final.text, values),
    };
  }
  function handoff(reason: string, status: 'handoff' | 'blocked' = 'handoff') {
    hint = '';
    return finish(
      {
        id: 'ayuda',
        label: 'Atención humana',
        kind: 'handoff',
        text: 'Un integrante del equipo continuará la atención por acá.',
        options: [],
      },
      status,
      reason,
    );
  }
  try {
    if (state?.status === 'blocked' || state?.status === 'handoff')
      return handoff(state.reason ?? 'El equipo tiene la atención.', state.status);
    if (!node) throw new Error('No se encontró el paso de la ejecución.');
    if (turns > 100)
      return handoff(
        'Se alcanzó el límite de 100 respuestas del recorrido. Revisá los datos antes de reanudar.',
        'blocked',
      );
    if (state?.status === 'waiting' && node.kind === 'capture') {
      const def = defs.find((d) => d.identifier === node!.variable);
      if (!def) throw new Error('La variable de captura no existe.');
      try {
        if (input.invalidChoice || input.optionId)
          throw new Error('Respondé con texto, no con un botón anterior.');
        values[node.variable!] = parseValue(def, input.text);
        node = graph.nodes.find((n) => n.id === node!.options[0].next);
      } catch (error) {
        misses = state.misses + 1;
        if (misses >= 3) return handoff('Tres respuestas inválidas requieren revisión del equipo.');
        hint = (error instanceof Error ? error.message : 'Revisá la respuesta.') + '\n\n';
        return finish(node!, 'waiting');
      }
    } else if (state?.status === 'waiting' && node.kind === 'menu') {
      const option = node.options.find((o, i) =>
        input.invalidChoice
          ? false
          : input.optionId
            ? input.optionId === o.id
            : normalize(input.text) === String(i + 1) ||
              normalize(input.text) === normalize(o.label),
      );
      if (!option) {
        misses = state.misses + 1;
        if (misses >= 3)
          return handoff('Tres opciones no reconocidas requieren revisión del equipo.');
        hint = 'Elegí una opción del menú para continuar.\n\n';
        return finish(node!, 'waiting');
      }
      const optionValues = { ...values };
      if (node.variable) {
        const def = defs.find((d) => d.identifier === node!.variable);
        if (!def) throw new Error('La variable del menú no existe.');
        optionValues[node.variable] = parseValue(def, option.value ?? option.label);
      }
      values = applyAssignments(defs, optionValues, option.assignments ?? []);
      node = graph.nodes.find((n) => n.id === option.next);
    }
    for (let hops = 0; node && ['condition', 'assign'].includes(node.kind); hops++) {
      if (hops >= 30)
        throw new Error('Se alcanzó el límite de pasos automáticos sin una respuesta.');
      let next: string;
      if (node.kind === 'assign') {
        values = applyAssignments(defs, values, node.assignments ?? []);
        next = node.options[0]?.next;
      } else {
        const def = defs.find((d) => d.identifier === node!.variable);
        if (!def || !node.operator) throw new Error('La condición no está configurada.');
        next = node.options[compareValue(def, values, node.operator, node.value) ? 0 : 1]?.next;
      }
      node = graph.nodes.find((n) => n.id === next);
    }
    if (!node) throw new Error('El destino del paso no existe.');
    return finish(
      node,
      ['menu', 'capture'].includes(node.kind)
        ? 'waiting'
        : node.kind === 'handoff'
          ? 'handoff'
          : 'completed',
    );
  } catch (error) {
    return handoff(
      error instanceof Error ? error.message : 'No pudimos evaluar el recorrido.',
      'blocked',
    );
  }
}
