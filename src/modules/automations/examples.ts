import type { FlowGraph } from './definition';
import type { VariableDefinition } from './variables';
export function variableExample(existing: VariableDefinition[] = []) {
  const needed: [string, VariableDefinition['type']][] = [
    ['red_social', 'text'],
    ['servicio', 'text'],
    ['cantidad', 'integer'],
    ['precio', 'currency'],
    ['estado_pedido', 'text'],
    ['copia_servicio', 'text'],
  ];
  const definitions: VariableDefinition[] = [];
  const names: Record<string, string> = {};
  for (const [base, type] of needed) {
    let identifier = base;
    let i = 1;
    while (existing.some((d) => d.identifier === identifier && d.type !== type))
      identifier = 'ejemplo_' + base + '_' + i++;
    names[base] = identifier;
    definitions.push(
      existing.find((d) => d.identifier === identifier) ?? {
        identifier,
        name: base.replaceAll('_', ' '),
        type,
        description: 'Ejemplo editable con datos ficticios',
        defaultValue: null,
        scope: 'execution',
        currency: 'ARS',
      },
    );
  }
  const reference = (name: string) => '{{' + names[name] + '}}';
  const graph: FlowGraph = {
    schemaVersion: 2,
    name: 'Ejemplo · Selección y confirmación',
    start: 'red',
    variables: definitions,
    nodes: [
      {
        id: 'red',
        label: 'Red social',
        kind: 'menu',
        variable: names.red_social,
        text: 'Ejemplo ficticio: ¿qué red social elegís?',
        options: ['Instagram', 'Facebook', 'TikTok'].map((label, i) => ({
          id: 'red' + i,
          label,
          value: label,
          next: 'servicio',
        })),
      },
      {
        id: 'servicio',
        label: 'Servicio',
        kind: 'menu',
        variable: names.servicio,
        text: '¿Qué servicio querés?',
        options: ['Seguidores', 'Likes', 'Vistas'].map((label, i) => ({
          id: 'servicio' + i,
          label,
          value: label,
          next: 'cantidad',
        })),
      },
      {
        id: 'cantidad',
        label: 'Cantidad',
        kind: 'menu',
        variable: names.cantidad,
        text: '¿Qué cantidad necesitás?',
        options: ['100', '500', '1000'].map((value, i) => ({
          id: 'cantidad' + i,
          label: value,
          value,
          next: 'confirmar',
          assignments: [
            { variable: names.precio, operation: 'set', value: ['1500', '7700', '15400'][i] },
            { variable: names.estado_pedido, operation: 'set', value: 'Pendiente de confirmación' },
          ],
        })),
      },
      {
        id: 'confirmar',
        label: 'Confirmar o corregir',
        kind: 'menu',
        text: `Hola, confirmá tu selección:\n\nElegiste ${reference('cantidad')} de ${reference('servicio')} para ${reference('red_social')}.\nImporte de ejemplo: ${reference('precio')}.\n\n¿Es correcto?`,
        options: [
          { id: 'si', label: 'Sí, continuar', next: 'guardar' },
          { id: 'no', label: 'No, modificar', next: 'cantidad' },
        ],
      },
      {
        id: 'guardar',
        label: 'Registrar confirmación',
        kind: 'assign',
        text: '',
        assignments: [
          { variable: names.estado_pedido, operation: 'set', value: 'Confirmado' },
          { variable: names.copia_servicio, operation: 'copy', value: names.servicio },
        ],
        options: [{ id: 'continuar', label: 'Continuar', next: 'fin' }],
      },
      {
        id: 'fin',
        label: 'Confirmación final',
        kind: 'message',
        text: `Confirmaste ${reference('cantidad')} de ${reference('servicio')} para ${reference('red_social')}.\nEstado: ${reference('estado_pedido')}.`,
        options: [],
      },
    ],
  };
  return { graph, definitions };
}
