'use client';
import { useEffect, useId, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { QrCode, Plus, RefreshCw, CheckCircle2, Unplug, Clock3, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { EvolutionChannelList, EvolutionChannelRow } from '@/modules/evolution/types';
import { whatsappRequest } from './http';

type Action =
  | { action: 'create'; name: string; phone: string }
  | {
      action: 'connect' | 'refresh' | 'disconnect';
      accountId: string;
      generation: number;
      idempotencyKey: string;
    };
const labels: Record<string, string> = {
  DISCONNECTED: 'Sin vincular',
  CONNECTING: 'Preparando QR',
  QR: 'Listo para escanear',
  QR_EXPIRED: 'Código vencido',
  CONNECTED: 'Conectado',
  DISCONNECTING: 'Desconectando',
  OFFLINE: 'Esperando conexión',
  ERROR: 'Necesita atención',
};
function explanation(session: EvolutionChannelRow) {
  if (session.lastErrorCode === 'NUMBER_MISMATCH')
    return 'Se escaneó desde otro número. La conexión se detuvo. Volvé a vincular el teléfono que preparaste.';
  if (session.lastErrorCode === 'INSTANCE_IDENTITY_UNAVAILABLE')
    return 'Todavía no pudimos comprobar qué teléfono se vinculó. Esperá la confirmación antes de responder.';
  if (session.state === 'OFFLINE')
    return 'No pudimos confirmar la conexión actual. Actualizá el estado o volvé a vincular el número.';
  if (session.state === 'ERROR')
    return session.desiredState === 'DISCONNECTED'
      ? 'Todavía no pudimos confirmar el cierre. Podés volver a solicitar la desconexión.'
      : 'No pudimos completar la vinculación. Tus datos se conservan; podés volver a intentarlo.';
  if (session.state === 'CONNECTING')
    return 'Estamos preparando el código. Podés cancelar la vinculación mientras esperás.';
  if (session.state === 'DISCONNECTING')
    return 'Esperando la confirmación del cierre. Tus contactos y conversaciones se conservan.';
  return null;
}
export function EvolutionChannels({ tenantId }: { tenantId: string }) {
  const phoneLabel = useId(),
    phoneHelp = useId();
  const [data, setData] = useState<EvolutionChannelList | null>(null),
    [loadError, setLoadError] = useState(''),
    [actionError, setActionError] = useState(''),
    [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Action | null>(null),
    [confirm, setConfirm] = useState<string | null>(null);
  const [name, setName] = useState('Atención al cliente'),
    [phone, setPhone] = useState(''),
    [showForm, setShowForm] = useState(false);
  const [clock, setClock] = useState(0),
    [offset, setOffset] = useState(0),
    [focusAccount, setFocusAccount] = useState<string | null>(null);
  const alive = useRef(false),
    busyRef = useRef(false),
    epoch = useRef(0),
    controller = useRef<AbortController | null>(null);
  const root = useRef<HTMLElement | null>(null);
  const focused = useRef<string | null>(null),
    phoneField = useRef<HTMLInputElement | null>(null),
    nameField = useRef<HTMLInputElement | null>(null);
  const endpoint = `/api/workspaces/${tenantId}/whatsapp/evolution/channels`;
  const loadRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    controller.current = abort;
    const load = async () => {
      const request = ++epoch.current;
      try {
        const next = await whatsappRequest<EvolutionChannelList>(
          endpoint,
          'GET',
          undefined,
          abort.signal,
        );
        if (alive.current && request === epoch.current) {
          setData(next);
          setOffset(next.serverTime - Date.now());
          setClock(Date.now());
          setLoadError('');
        }
      } catch (error) {
        if (alive.current && request === epoch.current)
          setLoadError(
            error instanceof Error ? error.message : 'No pudimos actualizar las conexiones.',
          );
      }
    };
    loadRef.current = load;
    void load();
    const poll = setInterval(() => {
      if (!busyRef.current && document.visibilityState === 'visible') void load();
    }, 3500);
    const tick = setInterval(() => setClock(Date.now()), 1000);
    const visible = () => {
      if (document.visibilityState === 'visible' && !busyRef.current) void load();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      alive.current = false;
      abort.abort();
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [endpoint]);
  useEffect(() => {
    if (
      !focusAccount ||
      focused.current === focusAccount ||
      !data?.sessions.some((session) => session.accountId === focusAccount)
    )
      return;
    root.current
      ?.querySelector<HTMLButtonElement>(
        `[data-evolution-account="${focusAccount}"] [data-evolution-connect]`,
      )
      ?.focus();
    focused.current = focusAccount;
  }, [focusAccount, data]);
  async function submit(payload: Action) {
    if (busyRef.current) return;
    busyRef.current = true;
    epoch.current++;
    setBusy(true);
    setActionError('');
    setNotice('');
    setPending(payload);
    try {
      const result = await whatsappRequest<{ accountId: string }>(
        endpoint,
        'POST',
        payload,
        controller.current?.signal,
      );
      if (!alive.current) return;
      setPending(null);
      setConfirm(null);
      if (payload.action === 'create') {
        setPhone('');
        setShowForm(false);
        setFocusAccount(result.accountId);
        focused.current = null;
        setNotice('Número preparado. Generá el QR para vincularlo.');
      } else
        setNotice(
          payload.action === 'disconnect'
            ? 'Cierre solicitado. Esperá la confirmación.'
            : 'Solicitud registrada. El QR aparecerá cuando esté listo.',
        );
      await loadRef.current();
    } catch (error) {
      if (alive.current) {
        setActionError(
          error instanceof Error ? error.message : 'No pudimos confirmar la solicitud.',
        );
        await loadRef.current();
      }
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function action(session: EvolutionChannelRow, kind: 'connect' | 'refresh' | 'disconnect') {
    setFocusAccount(null);
    void submit({
      action: kind,
      accountId: session.accountId,
      generation: session.generation,
      idempotencyKey: crypto.randomUUID(),
    });
  }
  const seconds = (session: EvolutionChannelRow) =>
    Math.max(0, Math.ceil((Date.parse(session.qrExpiresAt ?? '') - (clock + offset)) / 1000) || 0);
  return (
    <section className="evolution-channels" aria-label="Vinculación de WhatsApp" ref={root}>
      <header className="evo-channel-header">
        <span className="icon-tile">
          <QrCode size={25} />
        </span>
        <div>
          <h2>Vinculá tu WhatsApp</h2>
          <p>Escaneá un código y atendé desde tu bandeja.</p>
        </div>
        <span className="evo-channel-kind">Conexión por QR</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Actualizar estado"
          title="Actualizar estado"
          disabled={busy}
          onClick={() => void loadRef.current()}
        >
          <RefreshCw size={17} />
        </Button>
      </header>
      <p className="evo-connection-note">
        Vinculación no oficial. Puede requerir volver a conectar el número. La API oficial de Meta
        sigue disponible más abajo.
      </p>
      {!data ? (
        <div className="evo-channel-loading" role="status">
          {loadError ? 'No pudimos cargar los números.' : 'Cargando conexiones…'}
        </div>
      ) : !data.enabled ? (
        <p className="form-message">La vinculación todavía se está preparando.</p>
      ) : (
        <>
          {!data.configured && (
            <p className="form-message">
              El administrador debe completar la conexión antes de vincular un número.
            </p>
          )}
          {data.sessions.length === 0 && (
            <div className="evo-channel-empty">
              <QrCode size={34} />
              <div>
                <h3>Tu WhatsApp, en MONZO</h3>
                <p>
                  {data.canManage
                    ? 'Prepará el número que querés vincular. Después escaneá el QR desde ese teléfono.'
                    : 'El propietario de la empresa puede preparar y vincular un número.'}
                </p>
              </div>
            </div>
          )}
          <div className="evo-channel-list">
            {data.sessions.map((session) => {
              const remaining = seconds(session),
                expired =
                  session.state === 'QR_EXPIRED' || (session.state === 'QR' && remaining === 0);
              const cancelling =
                busy && pending?.action === 'disconnect' && pending.accountId === session.accountId;
              const qr = Boolean(
                !loadError &&
                !cancelling &&
                data.canManage &&
                session.qr &&
                !expired &&
                remaining > 0,
              );
              const state = expired ? 'QR_EXPIRED' : session.state;
              const detail = explanation(session);
              const waiting = ['CONNECTING', 'DISCONNECTING'].includes(session.state);
              return (
                <article
                  className="evo-channel-card"
                  data-evolution-account={session.accountId}
                  key={session.accountId}
                >
                  <div className="evo-channel-title">
                    <span className="evo-phone-icon">
                      <MessageCircle size={20} />
                    </span>
                    <div>
                      <h3>{session.name}</h3>
                      <p>+{session.expectedWaId}</p>
                    </div>
                    <span
                      className={`evo-channel-state ${state === 'CONNECTED' ? 'connected' : state === 'ERROR' || state === 'OFFLINE' ? 'attention' : ''}`}
                      role="status"
                    >
                      {state === 'CONNECTED' ? (
                        <CheckCircle2 size={14} />
                      ) : waiting ? (
                        <RefreshCw size={14} className="evo-spin" />
                      ) : null}
                      {labels[state] ?? 'Actualizando estado'}
                    </span>
                  </div>
                  {detail && <p className="evo-channel-detail">{detail}</p>}
                  {qr ? (
                    <div className="evo-qr-step">
                      <div className="evo-qr-image">
                        <Image
                          unoptimized
                          src={session.qr!}
                          width={232}
                          height={232}
                          alt={`QR para vincular el número +${session.expectedWaId}`}
                        />
                        <span className="evo-qr-countdown" aria-live="off">
                          <Clock3 size={13} />
                          Vence en {remaining} s
                        </span>
                      </div>
                      <div>
                        <h4>Vinculá este teléfono</h4>
                        <ol>
                          <li>
                            Abrí WhatsApp en el número <strong>+{session.expectedWaId}</strong>.
                          </li>
                          <li>
                            Entrá en <strong>Dispositivos vinculados</strong>.
                          </li>
                          <li>
                            Elegí <strong>Vincular un dispositivo</strong> y escaneá el código.
                          </li>
                        </ol>
                        <p>
                          No compartas el QR. Confirmaremos el número antes de habilitar la
                          conexión.
                        </p>
                      </div>
                    </div>
                  ) : expired ? (
                    <p className="evo-expired">
                      <Clock3 size={16} />
                      {data.canManage
                        ? 'El código venció. Solicitá uno nuevo para continuar.'
                        : 'El código venció. El propietario debe solicitar uno nuevo.'}
                    </p>
                  ) : session.state === 'QR' && !data.canManage ? (
                    <p className="evo-channel-detail">
                      El propietario debe escanear el código para completar la vinculación.
                    </p>
                  ) : session.state === 'QR' && !session.qr ? (
                    <p className="evo-channel-detail">
                      El código no está disponible. Podés solicitar uno nuevo.
                    </p>
                  ) : null}
                  {session.state === 'CONNECTED' && (
                    <p className="evo-connected-note">
                      <CheckCircle2 size={16} />
                      Número comprobado. Los mensajes aparecerán en Conversaciones.
                    </p>
                  )}
                  <div className="evo-channel-actions">
                    {session.state === 'CONNECTED' && (
                      <Button asChild variant="outline">
                        <Link href="/dashboard/conversaciones">
                          <MessageCircle size={16} />
                          Abrir conversaciones
                        </Link>
                      </Button>
                    )}
                    {data.canManage && (
                      <>
                        {['DISCONNECTED', 'OFFLINE'].includes(session.state) ||
                        (session.state === 'ERROR' && session.desiredState === 'CONNECTED') ? (
                          <Button
                            data-evolution-connect
                            type="button"
                            disabled={busy || !data.configured}
                            onClick={() => action(session, 'connect')}
                          >
                            <QrCode size={16} />
                            {session.state === 'DISCONNECTED' ? 'Generar QR' : 'Volver a vincular'}
                          </Button>
                        ) : null}
                        {(expired || (session.state === 'QR' && !session.qr)) &&
                          session.desiredState === 'CONNECTED' && (
                            <Button
                              type="button"
                              variant="outline"
                              disabled={busy || !data.configured}
                              onClick={() => action(session, 'refresh')}
                            >
                              <RefreshCw size={16} />
                              Solicitar nuevo QR
                            </Button>
                          )}
                        {session.state === 'ERROR' && session.desiredState === 'DISCONNECTED' && (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={busy}
                            onClick={() => action(session, 'disconnect')}
                          >
                            Reintentar desconexión
                          </Button>
                        )}
                        {session.desiredState === 'CONNECTED' &&
                          session.state !== 'DISCONNECTING' && (
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => setConfirm(session.accountId)}
                            >
                              <Unplug size={15} />
                              {session.state === 'CONNECTED'
                                ? 'Desconectar'
                                : 'Cancelar vinculación'}
                            </Button>
                          )}
                      </>
                    )}
                  </div>
                  {confirm === session.accountId && (
                    <div
                      className="evo-disconnect-confirm"
                      role="group"
                      aria-label="Confirmar desconexión"
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setConfirm(null);
                      }}
                    >
                      <p>
                        ¿Desconectar este número? Tus contactos y conversaciones guardados se
                        conservan.
                      </p>
                      <div>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setConfirm(null)}
                        >
                          Mantener conexión
                        </Button>
                        <Button
                          type="button"
                          disabled={busy}
                          onClick={() => action(session, 'disconnect')}
                        >
                          Confirmar desconexión
                        </Button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {data.canManage && data.sessions.length < 3 && (
            <div className="evo-channel-create">
              {data.sessions.length > 0 && !showForm ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setShowForm(true);
                    setFocusAccount(null);
                  }}
                >
                  <Plus size={16} />
                  Preparar otro número
                </Button>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!name.trim()) {
                      setActionError('Dale un nombre a esta conexión.');
                      nameField.current?.focus();
                      return;
                    }
                    if (
                      !/^\+?[0-9 ()-]{6,30}$/.test(phone.trim()) ||
                      !/^[1-9][0-9]{5,14}$/.test(phone.replace(/[^0-9]/g, ''))
                    ) {
                      setActionError(
                        'Ingresá el número completo, con código de país. Ejemplo: +54 9 11 5555 0000.',
                      );
                      phoneField.current?.focus();
                      return;
                    }
                    void submit({ action: 'create', name, phone });
                  }}
                >
                  <div>
                    <h3>Prepará tu número</h3>
                    <p>Indicá el teléfono que vas a escanear y un nombre para reconocerlo.</p>
                  </div>
                  <div className="evo-create-fields">
                    <label>
                      Nombre de la conexión
                      <input
                        required
                        ref={nameField}
                        maxLength={80}
                        value={name}
                        disabled={busy}
                        autoComplete="off"
                        onChange={(event) => setName(event.target.value)}
                      />
                    </label>
                    <label>
                      <span id={phoneLabel}>Número con código de país</span>
                      <input
                        required
                        ref={phoneField}
                        aria-labelledby={phoneLabel}
                        aria-describedby={phoneHelp}
                        type="tel"
                        inputMode="tel"
                        placeholder="+54 9 11 5555 0000"
                        maxLength={30}
                        value={phone}
                        disabled={busy}
                        autoComplete="tel"
                        onChange={(event) => setPhone(event.target.value)}
                      />
                      <small id={phoneHelp}>
                        Incluí el código de país. Podés usar +, espacios y paréntesis.
                      </small>
                    </label>
                  </div>
                  <div className="evo-channel-actions">
                    <Button type="submit" disabled={busy || !data.configured}>
                      <Plus size={16} />
                      {busy && pending?.action === 'create' ? 'Preparando…' : 'Preparar número'}
                    </Button>
                    {data.sessions.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setShowForm(false)}
                      >
                        Cancelar
                      </Button>
                    )}
                  </div>
                </form>
              )}
            </div>
          )}
        </>
      )}
      {loadError && (
        <div className="form-error evo-channel-error" role="alert">
          <span>{loadError}</span>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => void loadRef.current()}
          >
            <RefreshCw size={15} />
            Actualizar estado
          </Button>
        </div>
      )}
      {actionError && (
        <div className="form-error evo-channel-error" role="alert">
          <span>{actionError}</span>
          {pending && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => void submit(pending)}
            >
              Reintentar solicitud
            </Button>
          )}
        </div>
      )}
      <p className="evo-channel-notice" role="status" aria-live="polite">
        {busy ? 'Registrando solicitud…' : notice}
      </p>
    </section>
  );
}
