'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Server,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { whatsappRequest } from './http';
import type { EvolutionStatus, EvolutionReport } from '@/modules/evolution/types';

export function EvolutionConnection({ tenantId }: { tenantId: string }) {
  const [status, setStatus] = useState<EvolutionStatus | null>(null);
  const [report, setReport] = useState<EvolutionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const request = useRef<AbortController | null>(null);
  const endpoint = `/api/workspaces/${tenantId}/whatsapp/evolution`;
  useEffect(() => {
    const controller = new AbortController();
    void whatsappRequest<EvolutionStatus>(endpoint, 'GET', undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setStatus(data);
          setLoading(false);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(
            error instanceof Error ? error.message : 'No pudimos cargar el estado del servidor.',
          );
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, [endpoint, attempt]);
  const names = {
    service: 'Servicio Evolution',
    credential: 'Credencial interna',
    callback: 'Retorno a MONZO',
  };
  return (
    <section className="evolution-connection" aria-labelledby="evolution-title">
      <header className="evolution-heading">
        <span className="icon-tile">
          <Server size={23} />
        </span>
        <div>
          <h2 id="evolution-title">Servidor de WhatsApp</h2>
          <p>Conexión privada con Evolution API en tu VPS.</p>
        </div>
        <span className={`evolution-badge ${report?.ok ? 'evolution-ready' : ''}`}>
          {checking
            ? 'Comprobando…'
            : report?.ok
              ? 'Conexión comprobada'
              : report
                ? 'Requiere revisión'
                : status?.configured
                  ? 'Pendiente de comprobar'
                  : 'En preparación'}
        </span>
      </header>
      <p className="evolution-description">
        Comprobá que el servicio responde, que su credencial funciona y que puede comunicarse de
        vuelta con MONZO.
      </p>
      {loading ? (
        <p role="status">Cargando configuración…</p>
      ) : (
        <>
          {status && (
            <p id="evolution-configuration" className="evolution-help">
              {status.configurationMessage}
            </p>
          )}
          {status?.canCheck ? (
            <div className="evolution-actions">
              <Button
                type="button"
                variant="outline"
                disabled={checking || !status.configured}
                aria-describedby="evolution-configuration"
                onClick={async () => {
                  request.current?.abort();
                  const controller = new AbortController();
                  request.current = controller;
                  setChecking(true);
                  setError('');
                  setReport(null);
                  try {
                    const next = await whatsappRequest<EvolutionReport>(
                      endpoint,
                      'POST',
                      {},
                      controller.signal,
                    );
                    if (!controller.signal.aborted) setReport(next);
                  } catch (error) {
                    if (!controller.signal.aborted)
                      setError(
                        error instanceof Error
                          ? error.message
                          : 'No pudimos comprobar la conexión.',
                      );
                  } finally {
                    if (!controller.signal.aborted) setChecking(false);
                  }
                }}
              >
                {checking ? (
                  <LoaderCircle size={17} className="attachment-spinner" />
                ) : (
                  <ShieldCheck size={17} />
                )}{' '}
                {checking ? 'Comprobando servidor…' : 'Comprobar servidor'}
              </Button>
              <small>La comprobación no envía mensajes ni vincula teléfonos.</small>
            </div>
          ) : status ? (
            <p className="evolution-help">
              Un propietario de la empresa puede comprobar esta conexión.
            </p>
          ) : null}
          {checking && (
            <p role="status" className="evolution-help">
              Verificando el servicio y el retorno autenticado. Puede tardar hasta 30 segundos.
            </p>
          )}
          {report && (
            <div className="evolution-report" aria-live="polite">
              <ul>
                {report.checks.map((check) => (
                  <li key={check.name} className={check.ok ? 'check-ok' : 'check-pending'}>
                    {check.ok ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                    <span>
                      <strong>{names[check.name]}</strong>
                      <small>{check.message}</small>
                    </span>
                  </li>
                ))}
              </ul>
              <p>
                Comprobado el {new Date(report.checkedAt).toLocaleString('es-AR')}. El estado
                corresponde a ese momento.
              </p>
            </div>
          )}
        </>
      )}
      <p className="evolution-help">
        Este servicio utiliza Evolution API.{' '}
        <a
          href="https://github.com/evolution-foundation/evolution-api/blob/2.3.8/LICENSE"
          target="_blank"
          rel="noopener noreferrer"
        >
          Licencia y condiciones
        </a>
        .
      </p>
      {error && (
        <div className="form-error evolution-error" role="alert">
          <span>{error}</span>
          {!status && (
            <Button
              variant="ghost"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                setError('');
                setAttempt((value) => value + 1);
              }}
            >
              <RefreshCw size={15} />
              Reintentar
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
