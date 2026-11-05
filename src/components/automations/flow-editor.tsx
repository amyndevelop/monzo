'use client';
import { useEffect, useState, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import {
  GitBranch,
  Plus,
  Save,
  Play,
  Pause,
  FlaskConical,
  Trash2,
  Braces,
  CircleHelp,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { whatsappRequest } from '@/components/whatsapp/http';
import {
  exampleFlow,
  flowIssues,
  type FlowGraph,
  type FlowNode,
} from '@/modules/automations/definition';
import { VariableManager } from './variable-manager';
import { VariableSelect, VariableMessage, AssignmentFields } from './variable-fields';
import {
  allowedOperators,
  operators,
  type VariableDefinition,
} from '@/modules/automations/variables';
import { InboxNavigationToggle } from '@/components/platform/inbox-navigation';
import { WorkspaceDrawer } from './workspace-drawer';
import { FlowSimulator } from './simulator';
type FlowData = {
  variables: VariableDefinition[];
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
  capture: 'Guardar respuesta',
  condition: 'Evaluar condición',
  assign: 'Asignar variable',
  message: 'Respuesta final',
  handoff: 'Derivar al equipo',
};
export function AutomationPanel({ tenantId }: { tenantId: string }) {
  const [emptyVariablesOpen, setEmptyVariablesOpen] = useState(false);
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
    <div className="flow-page flow-studio">
      <header className="flow-studio-header">
        <div className="flow-studio-title">
          <InboxNavigationToggle />
          <div>
            <h1>Automatizaciones</h1>
            <p>Diseñá y probá el recorrido de tus clientes.</p>
          </div>
        </div>
        {accounts && accounts.accounts.length > 0 && (
          <label className="flow-channel">
            <span className="sr-only">Número de WhatsApp</span>
            <select
              aria-label="Número de WhatsApp"
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
        )}
      </header>
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
        <>
          <WorkspaceDrawer
            open={emptyVariablesOpen}
            onClose={() => setEmptyVariablesOpen(false)}
            title="Variables"
          >
            <VariableManager
              expanded
              tenantId={tenantId}
              graph={empty}
              canEdit={accounts.canEdit}
              createRequest={0}
              onChange={() => {}}
              onCreated={() => {}}
            />
          </WorkspaceDrawer>
          <section className="flow-card">
            <h2>Primero conectá un número</h2>
            <p>Los flujos se publican por número de WhatsApp.</p>
            <Link href="/dashboard/canales">Ir a Canales →</Link>
            <Button type="button" variant="outline" onClick={() => setEmptyVariablesOpen(true)}>
              Administrar variables
            </Button>
          </section>
        </>
      ) : (
        <>
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
  const [variablesOpen, setVariablesOpen] = useState(false),
    [helpOpen, setHelpOpen] = useState(false),
    [issuesOpen, setIssuesOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'tree' | 'step'>('tree');
  const [treeQuery, setTreeQuery] = useState('');
  const inspector = useRef<HTMLElement>(null);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const treeHeading = useRef<HTMLHeadingElement>(null);
  const selectStep = (id: string) => {
    setSelected(id);
    setMobilePanel('step');
    requestAnimationFrame(() => {
      if (inspector.current) inspector.current.scrollTop = 0;
      editorHeading.current?.focus({ preventScroll: true });
    });
  };
  const [registryRefresh, setRegistryRefresh] = useState(0);
  const [createRequest, setCreateRequest] = useState(0);
  const quickNode = useRef('');
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
        setGraph({
          ...(result.flow?.draft ?? empty),
          variables: result.variables,
          schemaVersion: 2,
        });
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
        setGraph({ ...result.flow!.draft, variables: result.variables, schemaVersion: 2 });
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
          options:
            kind === 'menu'
              ? [{ id: 'opcion1', label: '', next: '' }]
              : ['capture', 'assign'].includes(kind)
                ? [{ id: 'continuar', label: 'Continuar', next: '' }]
                : kind === 'condition'
                  ? [
                      { id: 'si', label: 'Sí', next: '' },
                      { id: 'no', label: 'No', next: '' },
                    ]
                  : [],
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
    <div className="flow-editor-shell">
      <WorkspaceDrawer
        open={variablesOpen}
        onClose={() => setVariablesOpen(false)}
        title="Variables"
      >
        {' '}
        <VariableManager
          expanded
          tenantId={tenantId}
          graph={graph}
          canEdit={canEdit}
          createRequest={createRequest}
          refreshKey={registryRefresh + (data.flow?.revision ?? 0)}
          onChange={(variables) => edit({ ...graph, variables, schemaVersion: 2 })}
          onCreated={(variable) => {
            const id = quickNode.current;
            quickNode.current = '';
            if (id) setVariablesOpen(false);
            if (id)
              setGraph((current) => ({
                ...current,
                nodes: current.nodes.map((n) =>
                  n.id === id ? { ...n, variable: variable.identifier } : n,
                ),
              }));
          }}
        />
      </WorkspaceDrawer>
      <WorkspaceDrawer
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Ayuda del constructor"
      >
        <p>
          Elegí un paso en el árbol para editar su mensaje y sus destinos. Guardá el borrador, probá
          el recorrido y publicá cuando esté listo.
        </p>
        <h3>Borrador y publicación</h3>
        <p>
          Guardar conserva tu trabajo; publicar activa esa versión para próximos mensajes. Un flujo
          por número. Las conversaciones existentes siguen bajo atención humana hasta reanudarlas.
        </p>
        <h3>Variables</h3>
        <p>
          El catálogo pertenece a la empresa. Cada ejecución guarda sus propios valores. Los cambios
          del catálogo necesitan republicarse para afectar la automatización.
        </p>
        <h3>WhatsApp</h3>
        <p>
          En la API oficial, las respuestas libres funcionan dentro de las 24 horas del último
          mensaje del cliente; fuera de esa ventana se usan plantillas aprobadas. La conexión QR usa
          texto y opciones numeradas, sin plantillas de Meta. Los mensajes ya enviados no se pueden
          retirar.
        </p>
        {!data.canEdit && (
          <p>
            Solo propietarios y administradores pueden editar. Podés revisar el árbol y simularlo.
          </p>
        )}
      </WorkspaceDrawer>
      <WorkspaceDrawer open={issuesOpen} onClose={() => setIssuesOpen(false)} title="Revisar flujo">
        <div id="flow-issues">
          <p>
            {issues.length
              ? 'Corregí estas configuraciones antes de probar o publicar.'
              : 'Los pasos tienen mensajes y destinos válidos. Probá el recorrido antes de publicarlo.'}
          </p>
          <ul>
            {issues.map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
          </ul>
        </div>
      </WorkspaceDrawer>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void persist('save');
        }}
        className="flow-workspace"
        onPointerDown={(event) => {
          for (const menu of event.currentTarget.querySelectorAll<HTMLDetailsElement>(
            '.flow-tree-tools details[open]',
          ))
            if (!menu.contains(event.target as Node)) menu.open = false;
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            const menu = event.currentTarget.querySelector<HTMLDetailsElement>(
              '.flow-tree-tools details[open]',
            );
            if (menu) {
              event.preventDefault();
              menu.open = false;
              menu.querySelector('summary')?.focus();
            }
          }
        }}
      >
        <div className="flow-toolbar flow-card">
          <div className="flow-identity">
            <label>
              <span className="sr-only">Nombre del flujo</span>
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
          </div>
          <div className="flow-actions">
            <Button
              type="submit"
              variant="outline"
              aria-label="Guardar borrador"
              title="Guardar borrador"
              disabled={!canEdit || !dirty}
            >
              <Save size={15} />
              <span className="flow-action-text">Guardar</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || issues.length > 0}
              aria-label="Probar recorrido"
              title="Probar recorrido"
              aria-describedby="flow-review-help"
              onClick={() => setSimulator(true)}
            >
              <FlaskConical size={15} />
              <span className="flow-action-text">Probar</span>
            </Button>
            <Button
              type="button"
              disabled={busy || Boolean(publishReason)}
              aria-label="Publicar y activar"
              aria-describedby="flow-publish-help"
              onClick={() => void persist('publish')}
            >
              <Play size={15} />
              Publicar
            </Button>
            {data.flow?.published && (
              <Button
                type="button"
                variant="outline"
                disabled={
                  !canEdit || (!data.flow.enabled && (!data.channelReady || !data.processorReady))
                }
                aria-label={data.flow.enabled ? 'Pausar flujo' : 'Reactivar publicado'}
                title={data.flow.enabled ? 'Pausar flujo' : 'Reactivar publicado'}
                onClick={() => void persist(data.flow!.enabled ? 'pause' : 'enable')}
              >
                {data.flow.enabled ? <Pause size={15} /> : <Play size={15} />}
                <span className="flow-action-text">
                  {data.flow.enabled ? 'Pausar' : 'Reactivar'}
                </span>
              </Button>
            )}
          </div>
          <div className="flow-utilities">
            <Button
              type="button"
              variant="outline"
              aria-label="Variables"
              title={`Variables (${graph.variables?.length ?? 0})`}
              onClick={() => setVariablesOpen(true)}
            >
              <Braces size={17} />
              <span className="flow-action-text">Variables</span>
              <small>{graph.variables?.length ?? 0}</small>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Ayuda del constructor"
              title="Ayuda del constructor"
              onClick={() => setHelpOpen(true)}
            >
              <CircleHelp size={18} />
            </Button>
          </div>
          <div className="flow-toolbar-feedback">
            <p id="flow-publish-help" className="flow-help">
              {busy
                ? 'Guardando cambios…'
                : publishReason || 'Guardá y probá el borrador antes de publicar.'}
            </p>
            <span id="flow-review-help">
              {issues.length > 0 && (
                <button
                  type="button"
                  className="flow-review-button"
                  onClick={() => setIssuesOpen(true)}
                >
                  Revisar {issues.length} {issues.length === 1 ? 'aviso' : 'avisos'}
                </button>
              )}
            </span>
          </div>
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
        <div className="flow-mobile-tabs" aria-label="Vista del constructor">
          <Button
            type="button"
            variant="ghost"
            aria-pressed={mobilePanel === 'tree'}
            onClick={() => {
              setMobilePanel('tree');
              requestAnimationFrame(() => treeHeading.current?.focus({ preventScroll: true }));
            }}
          >
            Árbol
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-pressed={mobilePanel === 'step'}
            onClick={() => {
              setMobilePanel('step');
              requestAnimationFrame(() => editorHeading.current?.focus({ preventScroll: true }));
            }}
          >
            Editar paso
          </Button>
        </div>
        <div className="flow-columns" data-view={mobilePanel}>
          <section className="flow-card flow-tree-panel">
            <div className="flow-heading">
              <h2 ref={treeHeading} tabIndex={-1}>
                Árbol de consultas
              </h2>
              <span>{graph.nodes.length} / 30 pasos</span>
            </div>
            <div className="flow-tree-tools">
              {' '}
              <fieldset disabled={!canEdit || graph.nodes.length >= 30} className="flow-add">
                <legend className="sr-only">Agregar paso</legend>
                <details className="flow-add-menu">
                  <summary>+ Agregar paso</summary>
                  <div>
                    {(
                      ['menu', 'capture', 'condition', 'assign', 'message', 'handoff'] as const
                    ).map((kind) => (
                      <Button
                        key={kind}
                        type="button"
                        variant="outline"
                        onClick={(event) => {
                          event.currentTarget.closest('details')?.removeAttribute('open');
                          add(kind);
                        }}
                      >
                        <Plus size={14} />
                        {kindLabels[kind]}
                      </Button>
                    ))}
                  </div>
                </details>{' '}
              </fieldset>
              {graph.nodes.length >= 30 && (
                <p className="flow-help">Llegaste al máximo de 30 pasos.</p>
              )}
              <details className="flow-examples">
                <summary>Ejemplos</summary>
                <div>
                  {' '}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!canEdit}
                    className="variable-example-button"
                    onClick={async (event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open');
                      if (
                        graph.nodes.length &&
                        !confirm(
                          '¿Reemplazar el borrador por un ejemplo ficticio? La publicación actual no cambia.',
                        )
                      )
                        return;
                      setBusy(true);
                      onBusy(true);
                      setError('');
                      try {
                        const result = await whatsappRequest<{ example: FlowGraph }>(
                          `/api/workspaces/${tenantId}/automation-variables`,
                          'POST',
                          { action: 'example' },
                        );
                        edit(result.example);
                        setRegistryRefresh((n) => n + 1);
                        setSelected(result.example.start);
                        setNotice(
                          'Ejemplo ficticio cargado. Revisá sus textos y valores antes de guardar o publicar.',
                        );
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'No pudimos cargar el ejemplo.');
                      } finally {
                        setBusy(false);
                        onBusy(false);
                      }
                    }}
                  >
                    Cargar ejemplo de variables y confirmación
                  </Button>
                </div>
              </details>
            </div>
            <label className="flow-tree-search">
              <Search size={15} />
              <span className="sr-only">Buscar un paso</span>
              <input
                value={treeQuery}
                onChange={(event) => setTreeQuery(event.target.value)}
                placeholder="Buscar un paso…"
              />
            </label>
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
                    edit({
                      ...structuredClone(exampleFlow),
                      variables: graph.variables,
                      schemaVersion: 2,
                    });
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
                  {treeQuery ? (
                    <div className="flow-search-results">
                      {graph.nodes
                        .filter((n) => n.label.toLowerCase().includes(treeQuery.toLowerCase()))
                        .map((n) => (
                          <button
                            key={n.id}
                            type="button"
                            className={`flow-node ${selected === n.id ? 'selected' : ''}`}
                            onClick={() => selectStep(n.id)}
                          >
                            {n.label}
                            <small>{kindLabels[n.kind]}</small>
                          </button>
                        ))}
                      {!graph.nodes.some((n) =>
                        n.label.toLowerCase().includes(treeQuery.toLowerCase()),
                      ) && <p>Sin coincidencias.</p>}
                    </div>
                  ) : (
                    <ol>{tree}</ol>
                  )}
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
          </section>
          <section className="flow-card flow-step" ref={inspector} aria-label="Editor del paso">
            <div className="flow-heading">
              <h2 ref={editorHeading} tabIndex={-1}>
                {node ? 'Editar paso' : 'Elegí un paso del árbol'}
              </h2>
              <button
                type="button"
                className="flow-back-tree"
                onClick={() => {
                  setMobilePanel('tree');
                  requestAnimationFrame(() => treeHeading.current?.focus({ preventScroll: true }));
                }}
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
                      updateNode({
                        ...node,
                        kind,
                        text: ['condition', 'assign'].includes(kind) ? '' : node.text,
                        variable: kind === 'assign' ? undefined : node.variable,
                        assignments: kind === 'assign' ? node.assignments : undefined,
                        options:
                          kind === 'menu'
                            ? node.options
                            : ['capture', 'assign'].includes(kind)
                              ? [{ id: 'continuar', label: 'Continuar', next: '' }]
                              : kind === 'condition'
                                ? [
                                    { id: 'si', label: 'Sí', next: '' },
                                    { id: 'no', label: 'No', next: '' },
                                  ]
                                : [],
                      });
                    }}
                  >
                    {Object.entries(kindLabels).map(([kind, label]) => (
                      <option key={kind} value={kind}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {['condition', 'assign'].includes(node.kind) ? (
                  <p className="flow-help">
                    Este paso no envía un mensaje; ejecuta sus operaciones y continúa.
                  </p>
                ) : (
                  <VariableMessage
                    graph={graph}
                    value={node.text}
                    onChange={(text) => updateNode({ ...node, text })}
                  />
                )}
                {node.kind === 'assign' && (
                  <AssignmentFields
                    definitions={graph.variables ?? []}
                    items={node.assignments ?? []}
                    onChange={(assignments) => updateNode({ ...node, assignments })}
                  />
                )}
                {['menu', 'capture', 'condition', 'assign'].includes(node.kind) ? (
                  <div className="flow-options">
                    <h3>Opciones y destinos</h3>
                    {node.kind !== 'menu' && (
                      <p className="flow-help">
                        Este tipo de paso usa destinos fijos: no se agregan ni se quitan opciones.
                      </p>
                    )}
                    {node.kind === 'menu' ? (
                      <details className="flow-save-answer" open={Boolean(node.variable)}>
                        <summary>Guardar selección en variable · opcional</summary>{' '}
                        <VariableSelect
                          definitions={graph.variables ?? []}
                          value={node.variable ?? ''}
                          optional
                          label="Guardar respuesta en variable"
                          onChange={(variable) =>
                            updateNode({ ...node, variable: variable || undefined })
                          }
                          onCreate={() => {
                            setVariablesOpen(true);
                            quickNode.current = node.id;
                            setCreateRequest((n) => n + 1);
                          }}
                        />
                      </details>
                    ) : node.kind !== 'assign' ? (
                      <>
                        {' '}
                        <VariableSelect
                          definitions={graph.variables ?? []}
                          value={node.variable ?? ''}
                          optional={false}
                          label={
                            node.kind === 'condition'
                              ? 'Variable a evaluar'
                              : 'Guardar respuesta en variable'
                          }
                          onChange={(variable) =>
                            updateNode({ ...node, variable: variable || undefined })
                          }
                          onCreate={() => {
                            setVariablesOpen(true);
                            quickNode.current = node.id;
                            setCreateRequest((n) => n + 1);
                          }}
                        />
                      </>
                    ) : null}
                    {node.kind === 'capture' && (
                      <p className="flow-help">
                        La respuesta se valida según el tipo elegido (hasta 120 caracteres). MENÚ e
                        INICIO comienzan otro recorrido. Volver a una pregunta conserva las demás
                        variables.
                      </p>
                    )}
                    {node.kind === 'condition' && (
                      <>
                        <label>
                          Comparación
                          <select
                            aria-label="Comparación"
                            value={node.operator ?? ''}
                            onChange={(event) =>
                              updateNode({
                                ...node,
                                operator: event.target.value as FlowNode['operator'],
                              })
                            }
                          >
                            <option value="">Elegí una comparación</option>
                            {allowedOperators(
                              graph.variables?.find((d) => d.identifier === node.variable)?.type ??
                                'text',
                            ).map((op) => (
                              <option key={op} value={op}>
                                {operators[op]}
                              </option>
                            ))}
                          </select>
                        </label>
                        {!['exists', 'empty', 'true', 'false'].includes(node.operator ?? '') && (
                          <label>
                            Valor esperado
                            <input
                              maxLength={120}
                              value={node.value ?? ''}
                              onChange={(event) =>
                                updateNode({ ...node, value: event.target.value })
                              }
                            />
                          </label>
                        )}
                        <p className="flow-help">
                          Primer destino: Sí. Segundo: No. Las comparaciones respetan el tipo de
                          dato; el texto no distingue tildes ni mayúsculas.
                        </p>
                      </>
                    )}
                    {node.kind === 'menu' && (
                      <details className="flow-inline-help">
                        <summary>Cómo se muestran las opciones en WhatsApp</summary>
                        <p className="flow-help">
                          En la API oficial, hasta 3 opciones se envían como botones; de 4 a 10,
                          como lista. En conexiones QR se envían como texto numerado. El cliente
                          puede responder con el número de opción.
                        </p>
                      </details>
                    )}
                    {node.options.map((option, index) => (
                      <div className="flow-option" key={option.id}>
                        <label>
                          {node.kind === 'menu' ? `Opción ${index + 1}` : option.label}
                          <input
                            readOnly={node.kind !== 'menu'}
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
                          {node.kind === 'menu'
                            ? `Destino de opción ${index + 1}`
                            : `Destino: ${option.label}`}
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
                        {node.kind === 'menu' && (
                          <details className="variable-option-extra">
                            <summary>Guardar valores de opción {index + 1}</summary>
                            {node.variable && (
                              <label>
                                Valor para {'{{' + node.variable + '}}'}
                                <input
                                  maxLength={120}
                                  value={option.value ?? option.label}
                                  onChange={(e) =>
                                    updateNode({
                                      ...node,
                                      options: node.options.map((o) =>
                                        o.id === option.id ? { ...o, value: e.target.value } : o,
                                      ),
                                    })
                                  }
                                />
                              </label>
                            )}
                            <p className="flow-help">
                              La selección guarda el texto visible si no configurás otro valor.
                              Podés agregar asignaciones a otras variables, en orden.
                            </p>
                            <AssignmentFields
                              definitions={graph.variables ?? []}
                              max={5}
                              items={option.assignments ?? []}
                              onChange={(assignments) =>
                                updateNode({
                                  ...node,
                                  options: node.options.map((o) =>
                                    o.id === option.id ? { ...o, assignments } : o,
                                  ),
                                })
                              }
                            />
                          </details>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Quitar opción ${index + 1}`}
                          disabled={node.kind !== 'menu'}
                          title={
                            node.kind !== 'menu'
                              ? 'Este tipo de paso usa destinos fijos.'
                              : undefined
                          }
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
                      disabled={node.kind !== 'menu' || node.options.length >= 10}
                      title={
                        node.kind !== 'menu'
                          ? 'Este tipo de paso usa destinos fijos.'
                          : node.options.length >= 10
                            ? 'El máximo es de 10 opciones.'
                            : undefined
                      }
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
            <button
              type="button"
              className="flow-inspector-review"
              onClick={() => setIssuesOpen(true)}
            >
              {issues.length
                ? `${issues.length} avisos antes de publicar`
                : 'Recorrido listo para probar'}{' '}
              →
            </button>
          </section>
        </div>
      </form>
      {simulator && (
        <FlowSimulator graph={structuredClone(graph)} onClose={() => setSimulator(false)} />
      )}
    </div>
  );
}
