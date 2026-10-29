'use client';
import { useEffect, useState } from 'react';
import { Link2, ShieldCheck, MessageCircle, Unplug, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { whatsappRequest } from './http';
import type { Channels } from '@/modules/whatsapp/types';
export function ChannelsPanel({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<Channels | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/api/workspaces/${tenantId}/whatsapp`;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const result = await whatsappRequest<Channels>(
          base + '/accounts',
          'GET',
          undefined,
          controller.signal,
        );
        if (active) setData(result);
      } catch (error) {
        if (active)
          setError(error instanceof Error ? error.message : 'No pudimos cargar los canales.');
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [base]);
  async function refresh() {
    setData(await whatsappRequest<Channels>(base + '/accounts'));
  }
  return (
    <div className="channels-panel">
      <section className="channel-intro">
        <span className="icon-tile">
          <MessageCircle size={24} />
        </span>
        <div>
          <h2>WhatsApp, conectado a tu equipo.</h2>
          <p>
            Conectá un número autorizado con la API oficial de Meta para recibir conversaciones y
            responder desde MONZO.
          </p>
        </div>
      </section>
      {!data ? (
        <p role="status">Cargando canales…</p>
      ) : (
        <>
          {!data.configured && (
            <div className="form-message">
              <strong>La conexión oficial está en preparación.</strong>
              <p>
                El administrador de la plataforma debe activar la integración con Meta antes de
                conectar un número. No hay un canal conectado automáticamente.
              </p>
            </div>
          )}
          {data.accounts.length === 0 ? (
            <div className="channel-empty">
              <Link2 size={28} />
              <h3>Todavía no hay números conectados.</h3>
              <p>
                {data.canManage
                  ? 'Cuando Meta esté preparado, completá los datos de tu número.'
                  : 'Un propietario de la empresa puede conectar WhatsApp.'}
              </p>
            </div>
          ) : (
            <div className="channel-cards">
              {data.accounts.map((account) => (
                <article className="channel-card" key={account.id}>
                  <div className="channel-card-title">
                    <span className="icon-tile">
                      <MessageCircle size={22} />
                    </span>
                    <div>
                      <h3>{account.displayName}</h3>
                      <p>{account.displayPhone}</p>
                    </div>
                    <span className="small-badge">
                      {account.enabled ? 'Número autorizado' : 'Desconectado'}
                    </span>
                  </div>
                  <p className="channel-explanation">
                    {account.enabled
                      ? 'Autorización del número comprobada en Meta. La recepción se verificará con el primer mensaje real.'
                      : 'El canal está deshabilitado en MONZO.'}
                  </p>
                  {account.lastErrorCode && (
                    <p className="form-error">
                      Meta informó un problema ({account.lastErrorCode}). Un propietario debe
                      revisar la conexión.
                    </p>
                  )}
                  {data.canManage && account.enabled && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          !confirm(
                            '¿Desconectar este número de MONZO? Se cancelarán los mensajes que todavía estén en cola.',
                          )
                        )
                          return;
                        setBusy(true);
                        setError('');
                        try {
                          await whatsappRequest(base + '/accounts/' + account.id, 'DELETE', {});
                          await refresh();
                          setMessage('Número desconectado.');
                        } catch (error) {
                          setError(
                            error instanceof Error ? error.message : 'No pudimos desconectar.',
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <Unplug size={15} />
                      Desconectar
                    </Button>
                  )}
                </article>
              ))}
            </div>
          )}
          {data.processorMode === 'qstash' && data.processorReady && (
            <p className="form-message">
              El procesamiento por eventos está configurado. La recepción y el envío se confirmarán
              con un mensaje real.
            </p>
          )}
          {data.accounts.some((a) => a.enabled) && !data.processorReady && (
            <p className="form-message">
              El procesamiento de envíos está en pausa. Los mensajes en cola todavía no se enviaron;
              revisá el servicio de procesamiento con el administrador.
            </p>
          )}
          {data.processorMode === 'qstash' && data.pendingJobs > 0 && data.canManage && (
            <div className="form-message">
              <p>Hay {data.pendingJobs} trabajos pendientes de programación o revisión.</p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await whatsappRequest(base + '/recover', 'POST', {});
                    await refresh();
                    setMessage(
                      'Pendientes revisados. Los envíos con resultado incierto no se repiten.',
                    );
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : 'No pudimos recuperar los pendientes.',
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <RefreshCw size={15} />
                Recuperar pendientes
              </Button>
            </div>
          )}
          {data.failedEvents > 0 && (
            <div className="form-error">
              <p>Hay {data.failedEvents} notificaciones de WhatsApp que necesitan revisión.</p>
              {data.canManage && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await whatsappRequest(base + '/retry', 'POST', {});
                      await refresh();
                    } catch {
                      setError('No pudimos reintentar el procesamiento.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <RefreshCw size={15} />
                  Reintentar recepción
                </Button>
              )}
            </div>
          )}
          {data.canManage && (
            <section className="connect-channel">
              <h2>Conectar o actualizar un número</h2>
              <p>
                Usá los datos de WhatsApp Business Cloud API de tu aplicación de Meta. El token se
                guarda cifrado y nunca se vuelve a mostrar. Copiá los dos identificadores numéricos
                y el token de acceso que aparecen en Meta.
              </p>
              <form
                className="account-form"
                autoComplete="off"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setBusy(true);
                  setError('');
                  setMessage('');
                  const form = event.currentTarget;
                  const fields = new FormData(form);
                  try {
                    await whatsappRequest(base + '/accounts', 'POST', {
                      businessAccountId: fields.get('businessAccountId'),
                      phoneNumberId: fields.get('phoneNumberId'),
                      accessToken: fields.get('accessToken'),
                    });
                    form.reset();
                    await refresh();
                    setMessage(
                      'Meta autorizó el número y la suscripción. Enviá un mensaje desde un teléfono de prueba para verificar la recepción.',
                    );
                  } catch (error) {
                    setError(error instanceof Error ? error.message : 'No pudimos conectar.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  ID de la cuenta de WhatsApp Business
                  <input
                    name="businessAccountId"
                    autoComplete="off"
                    spellCheck={false}
                    inputMode="numeric"
                    placeholder="Identificador numérico de Meta"
                    pattern="[0-9]{5,30}"
                    required
                    disabled={!data.configured || busy}
                  />
                </label>
                <label>
                  ID del número de teléfono
                  <input
                    name="phoneNumberId"
                    autoComplete="off"
                    spellCheck={false}
                    inputMode="numeric"
                    placeholder="Identificador numérico de Meta"
                    pattern="[0-9]{5,30}"
                    required
                    disabled={!data.configured || busy}
                  />
                </label>
                <label>
                  Token de acceso de Meta
                  <input
                    name="accessToken"
                    type="password"
                    autoComplete="new-password"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="Pegá el token de acceso generado en Meta"
                    minLength={20}
                    maxLength={4096}
                    required
                    disabled={!data.configured || busy}
                  />
                </label>
                <Button disabled={!data.configured || busy} type="submit">
                  <ShieldCheck size={17} />
                  {busy ? 'Verificando con Meta…' : 'Autorizar número y suscribir mensajes'}
                </Button>
              </form>
              <p className="channel-footnote">
                Esta conexión inicial es manual. El alta comercial mediante Meta Embedded Signup se
                preparará en una etapa posterior.
              </p>
            </section>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="form-message">
          {message}
        </p>
      )}
    </div>
  );
}
