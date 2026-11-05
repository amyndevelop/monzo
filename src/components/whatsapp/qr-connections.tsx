'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { QrCode, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { whatsappRequest } from './http';
type Status = {
  canManage: boolean;
  workerReady: boolean;
  sessions: {
    accountId: string;
    name: string;
    state: string;
    desiredState: string;
    generation: number;
    expectedWaId: string;
    connectedWaId: string | null;
    qr: string | null;
    qrExpiresAt: string | null;
    lastErrorCode: string | null;
  }[];
};
const states: Record<string, string> = {
  DISCONNECTED: 'Desconectado',
  DISCONNECTING: 'Desconectando',
  CONNECTING: 'Preparando conexión',
  QR: 'Escaneá el QR',
  CONNECTED: 'Conectado',
  OFFLINE: 'Servicio del VPS sin conexión',
  ERROR: 'La conexión necesita revisión',
};
export function QrConnections({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<Status | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [name, setName] = useState('WhatsApp por QR'),
    [phone, setPhone] = useState('');
  const base = `/api/workspaces/${tenantId}/whatsapp/qr`;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const result = await whatsappRequest<Status>(base, 'GET', undefined, controller.signal);
        if (active) {
          setData(result);
          setError('');
        }
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : 'No pudimos cargar las conexiones QR.');
      }
    };
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [base]);
  async function action(payload: unknown) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await whatsappRequest(base, 'POST', payload);
      setData(await whatsappRequest<Status>(base));
      setNotice('Solicitud registrada. El estado se actualizará al responder el servicio del VPS.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos completar la acción.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="qr-connections" aria-label="WhatsApp por QR">
      <header>
        <QrCode size={23} />
        <div>
          <h2>Conectá WhatsApp por QR</h2>
          <p>Baileys en tu VPS · Texto y árboles con opciones numeradas.</p>
        </div>
      </header>
      <p className="qr-disclosure">
        Conexión no oficial, sin tarifas de la API de Meta. Requiere el VPS encendido; puede
        desconectarse y existe riesgo de restricciones del número. Plantillas y adjuntos de Meta no
        están disponibles en este canal.
      </p>
      {!data ? (
        <p role="status">Cargando conexiones QR…</p>
      ) : (
        <>
          {!data.workerReady && (
            <p className="form-message">
              El servicio QR del VPS todavía no está disponible. Podés preparar el número y
              vincularlo cuando esté encendido.
            </p>
          )}
          {data.sessions.map((s) => (
            <article className="qr-session" key={s.accountId}>
              <div className="qr-session-heading">
                <div>
                  <strong>{s.name}</strong>
                  <p>+{s.expectedWaId}</p>
                </div>
                <span role="status">{states[s.state] ?? 'Estado no disponible'}</span>
              </div>
              {s.qr && data.canManage ? (
                <div className="qr-code">
                  <Image
                    unoptimized
                    src={s.qr}
                    alt={`QR para vincular WhatsApp +${s.expectedWaId}`}
                    width={280}
                    height={280}
                  />
                  <p>
                    En tu teléfono: WhatsApp → Dispositivos vinculados → Vincular dispositivo. Usá
                    el número +{s.expectedWaId}.
                  </p>
                  <small>El código caduca y se renueva automáticamente. No lo compartas.</small>
                </div>
              ) : s.state === 'QR' ? (
                <p>
                  {data.canManage
                    ? 'El QR está vencido o renovándose. Esperá la próxima actualización.'
                    : 'El propietario de la empresa debe escanear el QR.'}
                </p>
              ) : null}
              {s.lastErrorCode === 'NUMBER_MISMATCH' && (
                <p role="alert" className="form-error">
                  El teléfono vinculado no coincide con el número preparado. La conexión se detuvo.
                  Vinculá el número correcto.
                </p>
              )}
              {s.lastErrorCode &&
                !['NUMBER_MISMATCH', 'RECONNECTING', 'LOGGED_OUT'].includes(s.lastErrorCode) && (
                  <p className="form-message">
                    El servicio no pudo completar la sesión. Revisá el estado del contenedor antes
                    de volver a conectar.
                  </p>
                )}
              {data.canManage && (
                <div className="qr-actions">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      busy ||
                      !data.workerReady ||
                      s.state === 'CONNECTED' ||
                      s.state === 'CONNECTING' ||
                      s.state === 'QR' ||
                      s.state === 'DISCONNECTING'
                    }
                    onClick={() =>
                      void action({
                        action: 'connect',
                        accountId: s.accountId,
                        generation: s.generation,
                      })
                    }
                  >
                    <QrCode size={16} />
                    {s.state === 'DISCONNECTED' ? 'Vincular por QR' : 'Volver a conectar'}
                  </Button>
                  {s.desiredState === 'CONNECTED' && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            '¿Desconectar esta sesión de WhatsApp? Los mensajes y contactos guardados se conservan.',
                          )
                        )
                          void action({
                            action: 'disconnect',
                            accountId: s.accountId,
                            generation: s.generation,
                          });
                      }}
                    >
                      Desconectar
                    </Button>
                  )}
                </div>
              )}
            </article>
          ))}
          {data.canManage && data.sessions.length < 3 && (
            <details className="qr-create" open={data.sessions.length === 0}>
              <summary>Preparar un número para QR</summary>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void action({ action: 'create', name, phone });
                }}
              >
                <label>
                  Nombre de la conexión
                  <input
                    required
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <label>
                  Número de WhatsApp
                  <input
                    required
                    type="tel"
                    inputMode="numeric"
                    pattern="[1-9][0-9]{5,14}"
                    placeholder="Ej.: 5491155550000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={busy}
                  />
                  <small>Formato internacional, solo dígitos, sin + ni espacios.</small>
                </label>
                <Button type="submit" disabled={busy}>
                  Preparar número
                </Button>
              </form>
            </details>
          )}
        </>
      )}
      {error && (
        <div role="alert" className="form-error">
          {error}
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              try {
                setData(await whatsappRequest<Status>(base));
                setError('');
              } catch (e) {
                setError(e instanceof Error ? e.message : 'No pudimos actualizar.');
              }
            }}
          >
            <RefreshCw size={15} />
            Actualizar estado
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="form-message">
          {notice}
        </p>
      )}
    </section>
  );
}
