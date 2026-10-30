'use client';
import { useEffect, useRef, useState } from 'react';
import { Sparkles, Save, FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { whatsappRequest } from '@/components/whatsapp/http';
import { defaultAgent, type AgentForm, type AgentStatus } from '@/modules/ai/schema';
export function AgentLab({ tenantId }: { tenantId: string }) {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [form, setForm] = useState<AgentForm>(defaultAgent);
  const [question, setQuestion] = useState('');
  const [fictional, setFictional] = useState(false);
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [errorArea, setErrorArea] = useState<'save' | 'test'>('save');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const result = useRef<HTMLHeadingElement>(null);
  const base = `/api/workspaces/${tenantId}/ai`;
  useEffect(() => {
    const controller = new AbortController();
    whatsappRequest<AgentStatus>(base, 'GET', undefined, controller.signal)
      .then((data) => {
        setStatus(data);
        setForm(data.agent);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : 'No pudimos cargar el agente.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [base, loadAttempt]);
  const dirty = Boolean(status && JSON.stringify(form) !== JSON.stringify(status.agent));
  const blocked = !status?.configured
    ? 'Falta configurar la clave de Gemini en el servidor.'
    : dirty
      ? 'Guardá los cambios antes de probar: la respuesta usa la configuración guardada.'
      : !status.agent.enabled
        ? 'El laboratorio está pausado. Un administrador debe habilitarlo y guardar.'
        : status.used >= status.agent.dailyLimit
          ? 'Alcanzaste el límite diario de pruebas de esta empresa.'
          : !fictional
            ? 'Confirmá que todos los datos de esta prueba son ficticios y no confidenciales.'
            : !question.trim()
              ? 'Escribí una pregunta ficticia para comenzar.'
              : '';
  return (
    <div className="ai-lab">
      <section className="channel-intro">
        <span className="icon-tile">
          <Sparkles size={24} />
        </span>
        <div>
          <h2>Tu primer agente, en modo de prueba.</h2>
          <p>
            Definí cómo responde y probalo antes de llevarlo a la atención de clientes. No envía
            mensajes a WhatsApp.
          </p>
        </div>
      </section>
      <div className="form-message">
        <strong>Gemini gratuito · Solo datos ficticios</strong>
        <p>
          Google puede usar las entradas y respuestas para mejorar sus productos y permitir revisión
          humana. No ingreses datos personales, confidenciales ni conversaciones reales. MONZO no
          carga el historial del chat.
        </p>
        <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">
          Condiciones de Gemini ↗
        </a>
      </div>
      {loading ? (
        <p role="status">Cargando agente…</p>
      ) : !status ? (
        <>
          <p role="alert" className="form-error">
            {error}
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setLoading(true);
              setError('');
              setLoadAttempt((value) => value + 1);
            }}
          >
            Reintentar carga
          </Button>
        </>
      ) : (
        <>
          {!status.configured && (
            <div className="form-message">
              <strong>La conexión con Gemini está en preparación.</strong>
              <p>
                Podés preparar y guardar el agente. Para probarlo, el administrador debe crear una
                clave en un proyecto gratuito sin facturación activada y configurar GEMINI_API_KEY
                en el servidor.
              </p>
              <a
                href="https://aistudio.google.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
              >
                Crear clave en Google AI Studio ↗
              </a>
              <p>No pegues la clave en este formulario ni en un chat.</p>
            </div>
          )}
          <div className="ai-lab-grid">
            <form
              className="ai-card"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setErrorArea('save');
                setError('');
                setNotice('');
                try {
                  const data = await whatsappRequest<AgentStatus>(base, 'PUT', form);
                  setStatus(data);
                  setForm(data.agent);
                  setFictional(false);
                  setReply('');
                  setNotice('Configuración guardada. Las pruebas usarán estos datos.');
                } catch (error) {
                  setError(error instanceof Error ? error.message : 'No pudimos guardar.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <h2>Personalidad y conocimientos</h2>
              <p>
                Un agente de prueba por empresa. La IA puede equivocarse: revisá siempre sus
                respuestas.
              </p>
              <fieldset disabled={!status.canEdit || busy}>
                <label>
                  Nombre del agente
                  <input
                    value={form.name}
                    required
                    maxLength={80}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                  />
                </label>
                <label>
                  Instrucciones y tono
                  <textarea
                    rows={4}
                    maxLength={3000}
                    value={form.instructions}
                    onChange={(event) => setForm({ ...form, instructions: event.target.value })}
                    placeholder="Respondé de forma breve. Si faltan datos, derivá a una persona."
                  />
                </label>
                <label>
                  Conocimientos de prueba
                  <textarea
                    rows={7}
                    maxLength={10000}
                    value={form.knowledge}
                    onChange={(event) => setForm({ ...form, knowledge: event.target.value })}
                    placeholder="Ejemplo ficticio: Tienda Luna abre de lunes a viernes, de 9 a 18. Los cambios se aceptan durante 15 días."
                  />
                </label>
                <label>
                  Máximo de intentos por día
                  <input
                    type="number"
                    min={1}
                    max={50}
                    required
                    value={form.dailyLimit}
                    onChange={(event) =>
                      setForm({ ...form, dailyLimit: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="ai-check">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
                  />{' '}
                  Habilitar laboratorio de prueba
                </label>
              </fieldset>
              <Button type="submit" disabled={busy || !status.canEdit || !dirty}>
                <Save size={16} />
                {busy ? 'Procesando…' : 'Guardar agente'}
              </Button>
              {error && errorArea === 'save' && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {notice && (
                <p className="form-message" role="status">
                  {notice}
                </p>
              )}
              {!status.canEdit && (
                <p>Solo propietarios y administradores pueden editar o pausar el agente.</p>
              )}
              {!dirty && status.canEdit && (
                <p className="channel-footnote">No hay cambios pendientes de guardar.</p>
              )}
            </form>
            <section className="ai-card">
              <h2>
                <FlaskConical size={20} /> Laboratorio
              </h2>
              <p>
                <strong>
                  {status.used} / {status.agent.dailyLimit}
                </strong>{' '}
                intentos reservados hoy. Reinicio:{' '}
                {new Date(status.resetsAt).toLocaleString('es-AR', {
                  timeZone: 'America/Argentina/Buenos_Aires',
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                (hora argentina).
              </p>
              <p className="channel-footnote">
                Los intentos fallidos también cuentan. Las cuotas de Google y los límites
                compartidos de MONZO pueden reducir las pruebas disponibles.
              </p>
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (blocked || busy) return;
                  setBusy(true);
                  setErrorArea('test');
                  setError('');
                  setNotice('');
                  setReply('');
                  try {
                    const data = await whatsappRequest<{ text: string }>(base + '/test', 'POST', {
                      question,
                      fictional,
                    });
                    setReply(data.text);
                    requestAnimationFrame(() => result.current?.focus());
                  } catch (error) {
                    setError(
                      error instanceof Error ? error.message : 'No pudimos consultar Gemini.',
                    );
                  } finally {
                    try {
                      const data = await whatsappRequest<AgentStatus>(base);
                      setStatus(data);
                    } catch {
                      /* Keep user input and the last known usage; generation errors remain visible. */
                    }
                    setBusy(false);
                  }
                }}
              >
                <label>
                  Pregunta ficticia
                  <textarea
                    rows={4}
                    value={question}
                    maxLength={2000}
                    required
                    disabled={busy}
                    onChange={(event) => {
                      setQuestion(event.target.value);
                      setFictional(false);
                      setReply('');
                    }}
                    placeholder="¿Qué horarios tiene la tienda del ejemplo?"
                  />
                </label>
                <label className="ai-check">
                  <input
                    type="checkbox"
                    checked={fictional}
                    disabled={busy}
                    onChange={(event) => setFictional(event.target.checked)}
                  />
                  Confirmo que la pregunta y la configuración solo contienen datos ficticios, sin
                  información personal ni confidencial.
                </label>
                <Button
                  type="submit"
                  disabled={busy || Boolean(blocked)}
                  aria-describedby="ai-test-help"
                >
                  <Sparkles size={16} />
                  {busy ? 'Procesando…' : 'Probar respuesta'}
                </Button>
                <p id="ai-test-help" className="channel-footnote" role="status">
                  {busy
                    ? 'Esperando el resultado. No se enviará ningún mensaje a WhatsApp.'
                    : blocked ||
                      'Se enviarán a Google únicamente la pregunta y la configuración guardada.'}
                </p>
              </form>
              {error && errorArea === 'test' && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              {reply ? (
                <div className="ai-result">
                  <h3 tabIndex={-1} ref={result}>
                    Respuesta de prueba · Revisar
                  </h3>
                  <p>{reply}</p>
                </div>
              ) : (
                <div className="ai-empty">
                  La respuesta aparecerá acá. No se guarda en el historial de WhatsApp.
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
