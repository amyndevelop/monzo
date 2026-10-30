'use client';
import { useEffect, useState, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { GitBranch, Plus, Save, Play, Pause, FlaskConical, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { whatsappRequest } from '@/components/whatsapp/http';
import {
  exampleFlow,
  flowIssues,
  type FlowGraph,
  type FlowNode,
} from '@/modules/automations/definition';
import { FlowSimulator } from './simulator';
type FlowData = {
  flow: {
    draft: FlowGraph;
    published: FlowGraph | null;
    revision: number;
    publishedVersion: number;
    enabled: boolean;
  } | null;
  canEdit: boolean;
  runtimeIssue?: string | null;
  channelReady: boolean;
  processorReady: boolean;
};
type Accounts = {
  accounts: { id: string; displayPhone: string; displayName: string; enabled: boolean }[];
  canEdit: boolean;
};
const empty: FlowGraph = { name: '', start: '', nodes: [] };
const kindLabels = {
  menu: 'Pregunta con opciones',
  message: 'Respuesta final',
  handoff: 'Derivar al equipo',
};
export function AutomationPanel({ tenantId }: { tenantId: string }) {
  const [accounts, setAccounts] = useState<Accounts | null>(null);
  const [selected, setSelected] = useState('');
  const [dirty, setDirty] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    whatsappRequest<Accounts>(
      `/api/workspaces/${tenantId}/automations`,
      'GET',
      undefined,
      controller.signal,
    )
      .then((data) => {
        setAccounts(data);
        setSelected(data.accounts[0]?.id ?? '');
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : 'No pudimos cargar los números.');
      });
    return () => controller.abort();
  }, [tenantId, attempt]);
  return (
    <div className="flow-page">
      <section className="channel-intro">
        <span className="icon-tile">
          <GitBranch size={25} />
        </span>
        <div>
          <h2>Una pregunta. Un camino claro.</h2>
          <p>
            Diseñá consultas guiadas para WhatsApp. Probá el recorrido y publicalo cuando esté
            listo.
          </p>
        </div>
      </section>
      {!accounts ? (
        error ? (
          <div className="form-error" role="alert">
            {error}
            <Button
              variant="outline"
              onClick={() => {
                setError('');
                setAttempt(attempt + 1);
              }}
            >
              Reintentar
            </Button>
          </div>
        ) : (
          <p role="status">Cargando números…</p>
        )
      ) : !accounts.accounts.length ? (
        <section className="flow-card">
          <h2>Primero conectá un número</h2>
          <p>Los flujos se publican por número de WhatsApp.</p>
          <Link href="/dashboard/canales">Ir a Canales →</Link>
        </section>
      ) : (
        <>
          <label className="flow-account">
            Número de WhatsApp
            <select
              disabled={working}
              value={selected}
              onChange={(event) => {
                if (
                  dirty &&
                  !confirm('Hay cambios sin guardar. ¿Descartarlos y cambiar de número?')
                )
                  return;
                setDirty(false);
                setSelected(event.target.value);
              }}
            >
              {accounts.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.displayName} · {account.displayPhone}
                  {!account.enabled ? ' · Desconectado' : ''}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <FlowEditor
              key={selected}
              tenantId={tenantId}
              accountId={selected}
              onDirty={setDirty}
              onBusy={setWorking}
            />
          )}
        </>
      )}
    </div>
  );
}
function FlowEditor({
  tenantId,
  accountId,
  onDirty,
  onBusy,
}: {
  tenantId: string;
  accountId: string;
  onDirty: (value: boolean) => void;
  onBusy: (value: boolean) => void;
}) {
  const [data, setData] = useState<FlowData | null>(null);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const treeHeading = useRef<HTMLHeadingElement>(null);
  const selectStep = (id: string) => {
    setSelected(id);
    requestAnimationFrame(() => {
      if (matchMedia('(max-width: 1000px)').matches) editorHeading.current?.focus();
    });
  };
  const [graph, setGraph] = useState<FlowGraph>(empty);
  const [selected, setSelected] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [simulator, setSimulator] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const base = `/api/workspaces/${tenantId}/automations/${accountId}`;
  useEffect(() => {
    const controller = new AbortController();
    whatsappRequest<FlowData>(base, 'GET', undefined, controller.signal)
      .then((result) => {
        setData(result);
        setGraph(result.flow?.draft ?? empty);
        setSelected(result.flow?.draft.start ?? '');
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : 'No pudimos cargar el flujo.');
      });
    return () => controller.abort();
  }, [base, attempt]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const edit = (next: FlowGraph) => {
    setGraph(next);
    setDirty(true);
    onDirty(true);
    setNotice('');
  };
  const issues = flowIssues(graph);
  const node = graph.nodes.find((n) => n.id === selected);
  const updateNode = (next: FlowNode) =>
    edit({ ...graph, nodes: graph.nodes.map((n) => (n.id === next.id ? next : n)) });
  const canEdit = Boolean(data?.canEdit && !busy);
  const publishReason = !data?.canEdit
    ? 'Solo propietarios y administradores pueden publicar.'
    : dirty
      ? 'Guardá el borrador antes de publicar.'
      : !data?.flow
        ? 'Guardá tu primer borrador.'
        : issues.length
          ? 'Completá los pasos indicados antes de publicar.'
          : !data.channelReady
            ? 'Autorizá este número en Canales para poder publicar.'
            : !data.processorReady
              ? 'El procesamiento está en pausa. Revisalo en Canales.'
              : '';
  async function persist(action: 'save' | 'publish' | 'pause' | 'enable') {
    if (!data || busy) return;
    if (
      action === 'publish' &&
      !confirm(
        'Este flujo responderá a próximos mensajes del número seleccionado. Las conversaciones existentes seguirán bajo control humano hasta reanudarlas. ¿Publicar y activar?',
      )
    )
      return;
    setBusy(true);
    onBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await whatsappRequest<FlowData>(base, 'POST', {
        action,
        revision: data.flow?.revision ?? 0,
        ...(action === 'save' ? { graph } : {}),
      });
      setData(result);
      // Pausing the live version must never discard local draft edits.
      if (action === 'save') {
        setGraph(result.flow!.draft);
        setDirty(false);
        onDirty(false);
      }
      setNotice(
        action === 'save'
          ? 'Borrador guardado. La versión publicada sigue igual.'
          : action === 'pause'
            ? 'Flujo pausado. Se cancelaron sus respuestas pendientes; las que ya estaban enviándose pueden completarse.'
            : 'Flujo activo para próximos mensajes. No se enviaron mensajes al publicar.',
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No pudimos guardar el flujo.');
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  function add(kind: FlowNode['kind']) {
    if (graph.nodes.length >= 30) return;
    const id = crypto.randomUUID().replaceAll('-', '');
    edit({
      ...graph,
      start: graph.start || id,
      nodes: [
        ...graph.nodes,
        {
          id,
          label: `Paso ${graph.nodes.length + 1}`,
          kind,
          text: '',
          options: kind === 'menu' ? [{ id: 'opcion1', label: '', next: '' }] : [],
        },
      ],
    });
    selectStep(id);
  }
  const visited = new Set<string>();
  function draw(id: string): ReactNode {
    const current = graph.nodes.find((n) => n.id === id);
    if (!current) return <span className="flow-missing">Sin destino</span>;
    const seen = visited.has(id);
    visited.add(id);
    return (
      <li key={id}>
        <button
          type="button"
          className={`flow-node ${selected === id ? 'selected' : ''}`}
          aria-pressed={selected === id}
          onClick={() => selectStep(id)}
        >
          <span>
            {seen ? '↪ ' : ''}
            {current.label || 'Paso sin título'}
          </span>
          <small>
            {kindLabels[current.kind]}
            {graph.start === id ? ' · Inicio' : ''}
          </small>
        </button>
        {!seen && current.options.length > 0 && (
          <ol>
            {current.options.map((option) => (
              <li key={option.id}>
                <span className="flow-edge">{option.label || 'Opción sin texto'}</span>
                <ol>{draw(option.next)}</ol>
              </li>
            ))}
          </ol>
        )}
      </li>
    );
  }
  const tree = graph.start ? draw(graph.start) : null;
  return !data ? (
    <section className="flow-card">
      {error ? (
        <>
          <p role="alert" className="form-error">
            {error}
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setError('');
              setAttempt(attempt + 1);
            }}
          >
            Reintentar carga
          </Button>
        </>
      ) : (
        <p role="status">Cargando flujo…</p>
      )}
    </section>
  ) : (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void persist('save');
        }}
        className="flow-workspace"
      >
        <div className="flow-toolbar flow-card">
          <label>
            Nombre del flujo
            <input
              maxLength={80}
              disabled={!canEdit}
              value={graph.name}
              onChange={(event) => edit({ ...graph, name: event.target.value })}
              placeholder="Ej.: Consultas de mi negocio"
            />
          </label>
          <div className="flow-status">
            <span className="small-badge">
              {data.flow?.enabled
                ? data.runtimeIssue
                  ? 'Publicado · Requiere revisión'
                  : 'Publicado · Activo'
                : data.flow?.published
                  ? 'Publicado · Pausado'
                  : 'Sin publicar'}
            </span>
            <span>
              {dirty
                ? 'Cambios sin guardar'
                : data.flow
                  ? 'Borrador guardado'
                  : 'Todavía no hay borrador'}
              {data.flow?.published ? ` · Versión ${data.flow.publishedVersion}` : ''}
            </span>
          </div>
          <div className="flow-actions">
            <Button type="submit" variant="outline" disabled={!canEdit || !dirty}>
              <Save size={15} />
              Guardar borrador
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || issues.length > 0}
              aria-describedby="flow-issues"
              onClick={() => setSimulator(true)}
            >
              <FlaskConical size={15} />
              Probar recorrido
            </Button>
            <Button
              type="button"
              disabled={busy || Boolean(publishReason)}
              aria-describedby="flow-publish-help"
              onClick={() => void persist('publish')}
            >
              <Play size={15} />
              Publicar y activar
            </Button>
            {data.flow?.published && (
              <Button
                type="button"
                variant="outline"
                disabled={
                  !canEdit || (!data.flow.enabled && (!data.channelReady || !data.processorReady))
                }
                onClick={() => void persist(data.flow!.enabled ? 'pause' : 'enable')}
              >
                {data.flow.enabled ? <Pause size={15} /> : <Play size={15} />}
                {data.flow.enabled ? 'Pausar flujo' : 'Reactivar publicado'}
              </Button>
            )}
          </div>
          <p id="flow-publish-help" className="flow-help">
            {busy
              ? 'Guardando cambios…'
              : publishReason ||
                'Al publicar, este número responderá a próximos mensajes entrantes. Los mensajes ya enviados no se pueden retirar.'}
          </p>
          <p className="flow-help">
            El borrador no modifica las respuestas activas. Un flujo por número; sin IA. Dentro de
            las 24 horas del último mensaje del cliente. Para iniciar fuera de esa ventana, usá una
            plantilla aprobada.
          </p>
          {!data.canEdit && (
            <p className="flow-help">
              Podés revisar y simular el árbol. Solo un administrador o propietario puede editarlo.
            </p>
          )}
          {data.runtimeIssue && (
            <p className="form-error" role="status">
              {data.runtimeIssue}
            </p>
          )}
          {error && (
            <div role="alert" className="form-error">
              {error}{' '}
              <button
                type="button"
                onClick={() => {
                  if (dirty && !confirm('¿Descartar tus cambios y cargar la versión guardada?'))
                    return;
                  setDirty(false);
                  onDirty(false);
                  setData(null);
                  setError('');
                  setAttempt(attempt + 1);
                }}
              >
                Recargar versión
              </button>
            </div>
          )}
          {notice && (
            <p role="status" className="form-message">
              {notice}
            </p>
          )}
        </div>
        <div className="flow-columns">
          <section className="flow-card flow-tree-panel">
            <div className="flow-heading">
              <h2 ref={treeHeading} tabIndex={-1}>
                Árbol de consultas
              </h2>
              <span>{graph.nodes.length} / 30 pasos</span>
            </div>
            {!graph.nodes.length ? (
              <div className="flow-empty">
                <GitBranch size={36} />
                <h3>Empezá por una bienvenida</h3>
                <p>Agregá preguntas, respuestas y una opción para hablar con tu equipo.</p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!canEdit}
                  onClick={() => {
                    edit(structuredClone(exampleFlow));
                    setSelected(exampleFlow.start);
                  }}
                >
                  Usar ejemplo editable
                </Button>
              </div>
            ) : (
              <>
                <label>
                  Paso inicial
                  <select
                    disabled={!canEdit}
                    value={graph.start}
                    onChange={(event) => edit({ ...graph, start: event.target.value })}
                  >
                    <option value="">Elegí un paso</option>
                    {graph.nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.label || 'Sin título'}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flow-tree" aria-label="Conexiones del árbol">
                  <ol>{tree}</ol>
                  {graph.nodes.some((n) => !visited.has(n.id)) && (
                    <div className="flow-unlinked">
                      <h3>Pasos sin conectar</h3>
                      {graph.nodes
                        .filter((n) => !visited.has(n.id))
                        .map((n) => (
                          <button
                            type="button"
                            key={n.id}
                            className="flow-node"
                            onClick={() => selectStep(n.id)}
                          >
                            {n.label || 'Sin título'}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </>
            )}
            <fieldset disabled={!canEdit || graph.nodes.length >= 30} className="flow-add">
              <legend>Agregar paso</legend>
              {(['menu', 'message', 'handoff'] as const).map((kind) => (
                <Button key={kind} type="button" variant="outline" onClick={() => add(kind)}>
                  <Plus size={14} />
                  {kindLabels[kind]}
                </Button>
              ))}
            </fieldset>
            {graph.nodes.length >= 30 && (
              <p className="flow-help">Llegaste al máximo de 30 pasos.</p>
            )}
          </section>
          <section className="flow-card flow-step">
            <div className="flow-heading">
              <h2 ref={editorHeading} tabIndex={-1}>
                {node ? 'Editar paso' : 'Elegí un paso del árbol'}
              </h2>
              <button
                type="button"
                className="flow-back-tree"
                onClick={() => treeHeading.current?.focus()}
              >
                Volver al árbol ↑
              </button>
            </div>
            {node ? (
              <fieldset disabled={!canEdit}>
                <label>
                  Título del paso
                  <input
                    value={node.label}
                    maxLength={60}
                    onChange={(event) => updateNode({ ...node, label: event.target.value })}
                  />
                </label>
                <label>
                  Tipo de paso
                  <select
                    value={node.kind}
                    onChange={(event) => {
                      const kind = event.target.value as FlowNode['kind'];
                      if (
                        node.options.length &&
                        kind !== 'menu' &&
                        !confirm('Cambiar el tipo quitará las opciones de este paso. ¿Continuar?')
                      )
                        return;
                      updateNode({ ...node, kind, options: kind === 'menu' ? node.options : [] });
                    }}
                  >
                    {Object.entries(kindLabels).map(([kind, label]) => (
                      <option key={kind} value={kind}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Mensaje para el cliente
                  <textarea
                    rows={5}
                    maxLength={900}
                    value={node.text}
                    onChange={(event) => updateNode({ ...node, text: event.target.value })}
                    placeholder="Escribí el mensaje que verá en WhatsApp"
                  />
                </label>
                <span className="flow-help">{node.text.length} / 900 caracteres</span>
                {node.kind === 'menu' ? (
                  <div className="flow-options">
                    <h3>Opciones y destinos</h3>
                    <p className="flow-help">
                      Hasta 3 opciones se envían como botones; de 4 a 10, como lista. El cliente
                      también puede responder con el número de opción.
                    </p>
                    {node.options.map((option, index) => (
                      <div className="flow-option" key={option.id}>
                        <label>
                          Opción {index + 1}
                          <input
                            maxLength={20}
                            value={option.label}
                            placeholder="Ej.: Consultar horarios"
                            onChange={(event) =>
                              updateNode({
                                ...node,
                                options: node.options.map((o) =>
                                  o.id === option.id ? { ...o, label: event.target.value } : o,
                                ),
                              })
                            }
                          />
                        </label>
                        <label>
                          Destino de opción {index + 1}
                          <select
                            value={option.next}
                            onChange={(event) =>
                              updateNode({
                                ...node,
                                options: node.options.map((o) =>
                                  o.id === option.id ? { ...o, next: event.target.value } : o,
                                ),
                              })
                            }
                          >
                            <option value="">Elegí un paso</option>
                            {graph.nodes
                              .filter((n) => n.id !== node.id)
                              .map((n) => (
                                <option key={n.id} value={n.id}>
                                  {n.label || 'Sin título'}
                                </option>
                              ))}
                          </select>
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Quitar opción ${index + 1}`}
                          onClick={() =>
                            updateNode({
                              ...node,
                              options: node.options.filter((o) => o.id !== option.id),
                            })
                          }
                        >
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={node.options.length >= 10}
                      onClick={() =>
                        updateNode({
                          ...node,
                          options: [
                            ...node.options,
                            { id: crypto.randomUUID().replaceAll('-', ''), label: '', next: '' },
                          ],
                        })
                      }
                    >
                      <Plus size={14} />
                      Agregar opción
                    </Button>
                  </div>
                ) : (
                  <p className="flow-help">
                    {node.kind === 'handoff'
                      ? 'Después de este mensaje, el flujo se detiene hasta que el equipo lo reanude desde el chat.'
                      : 'Después de esta respuesta, el cliente puede escribir MENÚ para volver al inicio.'}
                  </p>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    if (
                      !confirm(
                        '¿Eliminar este paso? Sus conexiones quedarán sin destino hasta que las completes.',
                      )
                    )
                      return;
                    const remaining = graph.nodes
                      .filter((n) => n.id !== node.id)
                      .map((n) => ({
                        ...n,
                        options: n.options.map((o) =>
                          o.next === node.id ? { ...o, next: '' } : o,
                        ),
                      }));
                    edit({
                      ...graph,
                      start: graph.start === node.id ? '' : graph.start,
                      nodes: remaining,
                    });
                    setSelected(remaining[0]?.id ?? '');
                  }}
                >
                  <Trash2 size={15} />
                  Eliminar paso
                </Button>
              </fieldset>
            ) : (
              <p>Las conexiones muestran qué respuesta sigue después de cada opción.</p>
            )}
            <div id="flow-issues" className={issues.length ? 'flow-validation' : 'flow-valid'}>
              <h3>{issues.length ? 'Antes de publicar' : 'Recorrido listo para probar'}</h3>
              {issues.length ? (
                <ul>
                  {issues.map((issue, index) => (
                    <li key={index}>{issue}</li>
                  ))}
                </ul>
              ) : (
                <p>
                  Los pasos tienen mensajes y destinos válidos. Revisá el contenido en el simulador.
                </p>
              )}
            </div>
          </section>
        </div>
      </form>
      {simulator && (
        <FlowSimulator graph={structuredClone(graph)} onClose={() => setSimulator(false)} />
      )}
    </>
  );
}
