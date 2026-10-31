'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { whatsappRequest } from '@/components/whatsapp/http';
import {
  variableSchema,
  variableTypes,
  type VariableDefinition,
} from '@/modules/automations/variables';
import { variableReferences, type FlowGraph } from '@/modules/automations/definition';
type Row = VariableDefinition & {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  references: { accountId: string; version: string; step: string }[];
};
type Data = { variables: Row[]; canEdit: boolean };
const blank: VariableDefinition = {
  name: '',
  identifier: '',
  type: 'text',
  description: '',
  defaultValue: null,
  scope: 'execution',
  currency: 'ARS',
};
function definition(row: Row): VariableDefinition {
  return {
    name: row.name,
    identifier: row.identifier,
    type: row.type,
    description: row.description,
    defaultValue: row.defaultValue,
    scope: row.scope,
    currency: row.currency,
  };
}
export function VariableManager({
  tenantId,
  graph,
  canEdit,
  onChange,
  createRequest,
  onCreated,
  refreshKey = 0,
}: {
  refreshKey?: number;
  tenantId: string;
  graph: FlowGraph;
  canEdit: boolean;
  onChange: (defs: VariableDefinition[]) => void;
  createRequest: number;
  onCreated: (variable: VariableDefinition) => void;
}) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState<VariableDefinition | null>(null),
    [editing, setEditing] = useState<Row | null>(null),
    [formError, setFormError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null),
    name = useRef<HTMLInputElement>(null),
    lastCreate = useRef(createRequest);
  const inline = useRef(false);
  const isOpen = form !== null;
  const endpoint = `/api/workspaces/${tenantId}/automation-variables`;
  useEffect(() => {
    const c = new AbortController();
    void whatsappRequest<Data>(endpoint, 'GET', undefined, c.signal)
      .then(setData)
      .catch((e) => {
        if (!c.signal.aborted)
          setError(e instanceof Error ? e.message : 'No pudimos cargar las variables.');
      });
    return () => c.abort();
  }, [endpoint, attempt, refreshKey]);
  useEffect(() => {
    if (createRequest !== lastCreate.current) {
      lastCreate.current = createRequest;
      inline.current = true;
      setEditing(null);
      setForm({ ...blank });
      setFormError('');
    }
  }, [createRequest]);
  useEffect(() => {
    if (!isOpen) return;
    const el = dialog.current!,
      previous = document.activeElement;
    el.showModal();
    name.current?.focus();
    return () => {
      el.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [isOpen]);
  function open(row?: Row, duplicate = false) {
    inline.current = false;
    setEditing(duplicate ? null : (row ?? null));
    let def = row ? definition(row) : { ...blank };
    if (duplicate) {
      let i = 1;
      while (
        data?.variables.some((d) => d.identifier === def.identifier.slice(0, 29) + '_copia' + i)
      )
        i++;
      def = {
        ...def,
        name: (def.name + ' (copia)').slice(0, 80),
        identifier: def.identifier.slice(0, 29) + '_copia' + i,
      };
    }
    setForm(def);
    setFormError('');
  }
  async function mutate(body: unknown, created = false) {
    setBusy(true);
    setError('');
    setFormError('');
    try {
      const result = await whatsappRequest<Data>(endpoint, 'POST', body);
      setData(result);
      const defs = result.variables.map(definition);
      onChange(defs);
      if (created && form && inline.current) {
        const def = defs.find((d) => d.identifier === form.identifier);
        if (def) onCreated(def);
      }
      setForm(null);
      setEditing(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'No pudimos guardar la variable.';
      if (form) setFormError(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="flow-card variable-manager">
      <details>
        <summary>Variables {data ? `(${data.variables.length})` : ''}</summary>
        <p className="flow-help">
          Catálogo compartido por la empresa. Cada cliente conserva sus propios valores por
          ejecución. Los cambios no alteran una versión ya publicada.
        </p>
        {!data && !error && <p role="status">Cargando variables…</p>}
        {error && <p role="alert">{error}</p>}
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setError('');
            setAttempt((a) => a + 1);
          }}
        >
          Actualizar listado
        </Button>
        <Button
          type="button"
          disabled={!canEdit || !data || busy || data.variables.length >= 100}
          onClick={() => open()}
        >
          + Nueva variable
        </Button>
        {!canEdit && (
          <p className="flow-help">Solo propietarios y administradores pueden editar variables.</p>
        )}
        {data && data.variables.length >= 100 && (
          <p className="flow-help">El máximo es de 100 variables por empresa.</p>
        )}
        {data?.variables.length === 0 && (
          <p>No hay variables todavía. Creá la primera para guardar respuestas.</p>
        )}
        {data?.variables.map((row) => {
          const current = variableReferences(graph, row.identifier);
          const used = row.references.length + current.length > 0;
          return (
            <article key={row.id} className="variable-row">
              <div>
                <h3>{row.name}</h3>
                <code>{'{{' + row.identifier + '}}'}</code>
                <p>{variableTypes[row.type]} · Por ejecución</p>
                <p>{row.description || 'Sin descripción'}</p>
              </div>
              <div className="variable-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!canEdit || busy}
                  aria-label={`Editar ${row.identifier}`}
                  onClick={() => open(row)}
                >
                  Editar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!canEdit || busy || data.variables.length >= 100}
                  aria-label={`Duplicar ${row.identifier}`}
                  onClick={() => open(row, true)}
                >
                  Duplicar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!canEdit || busy || used}
                  aria-label={`Eliminar ${row.identifier}`}
                  onClick={() => {
                    if (confirm(`¿Eliminar ${row.name}? No se borra el historial de mensajes.`))
                      void mutate({ action: 'delete', id: row.id, revision: row.revision });
                  }}
                >
                  Eliminar
                </Button>
              </div>
              {used && (
                <p className="flow-help">
                  En uso:{' '}
                  {[...new Set([...current, ...row.references.map((r) => r.step)])].join(', ')}.
                  Quitá sus referencias del borrador y la publicación para eliminar o cambiar
                  tipo/identificador.
                </p>
              )}
              <details>
                <summary>Detalles de {row.identifier}</summary>
                <p className="flow-help">
                  Creada: {new Date(row.createdAt).toLocaleString('es-AR')}. Modificada:{' '}
                  {new Date(row.updatedAt).toLocaleString('es-AR')}. Predeterminado:{' '}
                  {row.defaultValue ?? 'Sin valor'}.
                </p>
              </details>
            </article>
          );
        })}
      </details>
      {form && (
        <dialog
          ref={dialog}
          className="variable-dialog"
          aria-labelledby="variable-dialog-title"
          onCancel={(e) => {
            e.preventDefault();
            if (!busy) setForm(null);
          }}
        >
          <header>
            <h2 id="variable-dialog-title">{editing ? 'Editar variable' : 'Nueva variable'}</h2>
          </header>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = variableSchema.safeParse(form);
              if (!parsed.success) {
                setFormError(
                  'Revisá los campos. El identificador usa letras minúsculas, números y guion bajo; comienza con letra.',
                );
                return;
              }
              void mutate(
                {
                  ...(editing
                    ? { action: 'update', id: editing.id, revision: editing.revision }
                    : { action: 'create' }),
                  variable: parsed.data,
                },
                !editing,
              );
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Nombre descriptivo
                <input
                  ref={name}
                  required
                  maxLength={80}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                Identificador
                <input
                  required
                  maxLength={40}
                  value={form.identifier}
                  disabled={Boolean(editing?.references.length)}
                  onChange={(e) => setForm({ ...form, identifier: e.target.value })}
                  placeholder="Ej.: cantidad"
                />
              </label>
              <label>
                Tipo de dato
                <select
                  aria-label="Tipo de dato"
                  value={form.type}
                  disabled={Boolean(editing?.references.length)}
                  onChange={(e) =>
                    setForm({ ...form, type: e.target.value as VariableDefinition['type'] })
                  }
                >
                  {Object.entries(variableTypes).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {editing?.references.length ? (
                <p className="flow-help">
                  Identificador y tipo están bloqueados porque hay pasos guardados o publicados que
                  los usan. Podés duplicar la variable para crear otra.
                </p>
              ) : null}
              <label>
                Descripción opcional
                <textarea
                  rows={2}
                  maxLength={300}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </label>
              {form.type === 'currency' && (
                <label>
                  Código de moneda (ISO)
                  <input
                    required
                    pattern="[A-Z]{3}"
                    maxLength={3}
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                  />
                </label>
              )}
              <label className="variable-check">
                <input
                  type="checkbox"
                  checked={form.defaultValue !== null}
                  onChange={(e) => setForm({ ...form, defaultValue: e.target.checked ? '' : null })}
                />
                Usar valor predeterminado
              </label>
              {form.defaultValue !== null && (
                <label>
                  Valor predeterminado
                  <input
                    required
                    maxLength={120}
                    value={form.defaultValue}
                    onChange={(e) => setForm({ ...form, defaultValue: e.target.value })}
                  />
                </label>
              )}
              <label>
                Alcance
                <select value="execution" onChange={() => {}} aria-label="Alcance">
                  <option value="execution">Por ejecución</option>
                  <option disabled>Por conversación · Próximamente</option>
                  <option disabled>Por contacto · Próximamente</option>
                </select>
              </label>
              <p className="flow-help">
                Este MVP guarda valores por recorrido. Contacto y conversación todavía no están
                disponibles. El catálogo se guarda ahora; publicá el flujo para usar sus cambios. No
                pidas contraseñas, tarjetas ni datos sensibles.
              </p>
              <p className="flow-help">
                Números: sin separadores de miles; decimales con punto o coma. Fecha: AAAA-MM-DD.
                Fecha y hora: ISO con zona.
              </p>
            </fieldset>
            {formError && <p role="alert">{formError}</p>}
            <footer>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setForm(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Guardando…' : 'Guardar variable'}
              </Button>
            </footer>
          </form>
        </dialog>
      )}
    </section>
  );
}
