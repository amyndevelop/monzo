'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { effectiveVariables, type FlowGraph } from '@/modules/automations/definition';
import { interpolate } from '@/modules/automations/engine';
import {
  sampleValue,
  variableTypes,
  type Assignment,
  type VariableDefinition,
} from '@/modules/automations/variables';
export function VariableSelect({
  definitions,
  value,
  onChange,
  label = 'Guardar respuesta en variable',
  optional = false,
  onCreate,
}: {
  definitions: VariableDefinition[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  optional?: boolean;
  onCreate?: () => void;
}) {
  return (
    <div className="variable-select">
      <label>
        {label}
        <select
          aria-label={label}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        >
          <option value="">{optional ? 'No guardar esta selección' : 'Elegí una variable'}</option>
          {definitions.map((d) => (
            <option key={d.identifier} value={d.identifier}>
              {d.name} · {'{{' + d.identifier + '}}'} · {variableTypes[d.type]}
            </option>
          ))}
        </select>
      </label>
      {value && !definitions.some((d) => d.identifier === value) && (
        <p role="alert" className="flow-help">
          Variable sin definir: {value}. Creala o elegí otra.
        </p>
      )}
      {onCreate && (
        <Button type="button" variant="ghost" onClick={onCreate}>
          + Nueva variable sin salir
        </Button>
      )}
    </div>
  );
}
export function AssignmentFields({
  definitions,
  items,
  onChange,
  max = 10,
}: {
  definitions: VariableDefinition[];
  items: Assignment[];
  onChange: (items: Assignment[]) => void;
  max?: number;
}) {
  return (
    <div className="variable-assignments">
      {items.map((item, index) => (
        <fieldset key={index}>
          <legend>Asignación {index + 1}</legend>
          <VariableSelect
            definitions={definitions}
            value={item.variable}
            onChange={(variable) =>
              onChange(items.map((a, i) => (i === index ? { ...a, variable } : a)))
            }
            label={`Variable de asignación ${index + 1}`}
          />
          <label>
            Operación
            <select
              value={item.operation}
              onChange={(e) =>
                onChange(
                  items.map((a, i) =>
                    i === index
                      ? { ...a, operation: e.target.value as Assignment['operation'] }
                      : a,
                  ),
                )
              }
            >
              <option value="set">Asignar / reemplazar valor</option>
              <option value="clear">Limpiar valor</option>
              <option value="copy">Copiar desde otra variable</option>
            </select>
          </label>
          {item.operation === 'copy' ? (
            <VariableSelect
              definitions={definitions}
              value={item.value}
              label={`Origen de asignación ${index + 1}`}
              onChange={(value) =>
                onChange(items.map((a, i) => (i === index ? { ...a, value } : a)))
              }
            />
          ) : item.operation === 'set' ? (
            <label>
              Valor a asignar
              <input
                maxLength={120}
                value={item.value}
                onChange={(e) =>
                  onChange(items.map((a, i) => (i === index ? { ...a, value: e.target.value } : a)))
                }
              />
            </label>
          ) : (
            <p className="flow-help">
              Deja esta variable vacía; conserva los demás valores del recorrido.
            </p>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            Quitar asignación {index + 1}
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={items.length >= max || !definitions.length}
        onClick={() =>
          onChange([
            ...items,
            { variable: definitions[0]?.identifier ?? '', operation: 'set', value: '' },
          ])
        }
      >
        + Agregar asignación
      </Button>
      {!definitions.length ? (
        <p className="flow-help">Creá una variable en Variables para poder asignar valores.</p>
      ) : items.length >= max ? (
        <p className="flow-help">Este bloque admite hasta {max} asignaciones.</p>
      ) : null}
    </div>
  );
}
export function VariableMessage({
  graph,
  value,
  onChange,
}: {
  graph: FlowGraph;
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [show, setShow] = useState(false);
  const [insertError, setInsertError] = useState('');
  const definitions = effectiveVariables(graph);
  const [examples, setExamples] = useState<Record<string, string>>({});
  const samples = Object.fromEntries(
    definitions.map((d) => [d.identifier, examples[d.identifier] ?? sampleValue(d)]),
  );
  let preview = '';
  try {
    preview = interpolate(graph, value, samples, true);
  } catch {
    preview = 'Revisá los valores de ejemplo.';
  }
  return (
    <>
      <label>
        Mensaje para el cliente
        <textarea
          aria-label="Mensaje para el cliente"
          ref={ref}
          rows={5}
          maxLength={900}
          value={value}
          onChange={(e) => {
            setInsertError('');
            onChange(e.target.value);
          }}
          placeholder="Escribí el mensaje que verá en WhatsApp"
        />
      </label>
      <Button type="button" variant="outline" onClick={() => setShow(!show)} aria-expanded={show}>
        {'{ } Insertar variable'}
      </Button>
      {show && (
        <div className="variable-picker" aria-label="Variables disponibles">
          {definitions.length ? (
            definitions.map((d) => (
              <button
                key={d.identifier}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const el = ref.current;
                  const start = el?.selectionStart ?? value.length,
                    end = el?.selectionEnd ?? value.length,
                    token = '{{' + d.identifier + '}}';
                  if (value.length - (end - start) + token.length > 900) {
                    setInsertError(
                      'La referencia no cabe: el mensaje admite hasta 900 caracteres. Quitá texto o reemplazá una selección.',
                    );
                    return;
                  }
                  setInsertError('');
                  onChange(value.slice(0, start) + token + value.slice(end));
                  setShow(false);
                  requestAnimationFrame(() => {
                    el?.focus();
                    el?.setSelectionRange(start + token.length, start + token.length);
                  });
                }}
              >
                <strong>{d.name}</strong>
                <code>{'{{' + d.identifier + '}}'}</code>
                <small>
                  {variableTypes[d.type]} · {d.description || 'Sin descripción'}
                </small>
              </button>
            ))
          ) : (
            <p className="flow-help">Creá una variable en el panel Variables.</p>
          )}
        </div>
      )}
      {insertError && (
        <p role="alert" className="flow-help">
          {insertError}
        </p>
      )}
      <p className="flow-help">
        {value.length} / 900 caracteres. Las referencias {'{{variable}}'} se sustituyen antes de
        enviar. El mensaje completo debe caber en 900 caracteres.
      </p>
      <details className="variable-preview">
        <summary>Vista previa con valores de ejemplo</summary>
        <p className="flow-help">
          Ejemplos locales, sin datos reales del cliente. No cambian valores predeterminados.
        </p>
        {definitions
          .filter((d) => value.includes('{{' + d.identifier + '}}'))
          .map((d) => (
            <label key={d.identifier}>
              {d.name} · {variableTypes[d.type]}
              <input
                value={examples[d.identifier] ?? sampleValue(d)}
                maxLength={120}
                onChange={(e) => setExamples({ ...examples, [d.identifier]: e.target.value })}
              />
            </label>
          ))}
        <pre>{preview}</pre>
        {preview.length > 900 && <p role="alert">El ejemplo supera los 900 caracteres.</p>}
        <div className="variable-tokens">
          {[...value.matchAll(/\{\{([^{}]+)\}\}/g)].map((m, i) => (
            <span
              key={i}
              className={definitions.some((d) => d.identifier === m[1]) ? '' : 'missing'}
            >
              {m[0]}
              {!definitions.some((d) => d.identifier === m[1]) ? ' · sin definir' : ''}
            </span>
          ))}
        </div>
      </details>
    </>
  );
}
