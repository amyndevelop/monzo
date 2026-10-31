'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BarChart3, Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { whatsappRequest } from '@/components/whatsapp/http';
import type { AnalyticsReport } from '@/modules/analytics/core';
const number = (value: number) => value.toLocaleString('es-AR');
const labels: Record<string, string> = {
  QUEUED: 'En cola',
  SENDING: 'Enviando',
  SENT: 'Aceptado, sin entrega confirmada',
  DELIVERED: 'Entregado, sin lectura confirmada',
  READ: 'Leído',
  FAILED: 'Fallido',
  UNKNOWN: 'Resultado incierto',
  CANCELED: 'Cancelado',
};
export function AnalyticsPanel({ tenantId }: { tenantId: string }) {
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [accounts, setAccounts] = useState<AnalyticsReport['accounts']>([]);
  const [form, setForm] = useState({ from: '', to: '', accountId: '' });
  const [query, setQuery] = useState('days=7');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void whatsappRequest<AnalyticsReport>(
      `/api/workspaces/${tenantId}/analytics?${query}`,
      'GET',
      undefined,
      controller.signal,
    )
      .then((data) => {
        if (!active) return;
        setReport(data);
        setAccounts(data.accounts);
        setForm({
          from: data.filters.from,
          to: data.filters.to,
          accountId: data.filters.accountId,
        });
        setReady(true);
        setBusy(false);
      })
      .catch((error) => {
        if (!active) return;
        setError(error instanceof Error ? error.message : 'No pudimos cargar las analíticas.');
        setBusy(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [tenantId, query, attempt]);
  function request(next = query) {
    setBusy(true);
    setError('');
    setReport(null);
    setQuery(next);
    setAttempt((a) => a + 1);
  }
  const dirty = Boolean(
    report &&
    (form.from !== report.filters.from ||
      form.to !== report.filters.to ||
      form.accountId !== report.filters.accountId),
  );
  function formQuery() {
    return new URLSearchParams({
      from: form.from,
      to: form.to,
      ...(form.accountId ? { accountId: form.accountId } : {}),
    }).toString();
  }
  function exportDays() {
    if (!report) return;
    const csv =
      '\uFEFFfecha,mensajes_recibidos,envios_registrados\r\n' +
      report.days.map((day) => `${day.date},${day.inbound},${day.outbound}`).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `monzo-actividad-${report.filters.from}-${report.filters.to}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="analytics-panel">
      <section className="analytics-card" aria-labelledby="analytics-filters">
        <div className="analytics-heading">
          <div>
            <h2 id="analytics-filters">Tu atención, en números</h2>
            <p>Datos registrados en MONZO, sin consultar servicios externos.</p>
          </div>
          <BarChart3 aria-hidden="true" size={28} />
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            request(
              new URLSearchParams({
                from: form.from,
                to: form.to,
                ...(form.accountId ? { accountId: form.accountId } : {}),
              }).toString(),
            );
          }}
        >
          <fieldset disabled={busy || !ready} className="analytics-filters">
            <legend className="sr-only">Filtros del informe</legend>
            <label>
              Desde
              <input
                type="date"
                required
                value={form.from}
                onChange={(event) => setForm({ ...form, from: event.target.value })}
              />
            </label>
            <label>
              Hasta (inclusive)
              <input
                type="date"
                required
                value={form.to}
                onChange={(event) => setForm({ ...form, to: event.target.value })}
              />
            </label>
            <label>
              Canal
              <select
                aria-label="Canal"
                value={form.accountId}
                onChange={(event) => setForm({ ...form, accountId: event.target.value })}
              >
                <option value="">Todos los canales</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.displayName} · {account.displayPhone}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit">Aplicar filtros</Button>
          </fieldset>
        </form>
        <div className="analytics-actions">
          {[7, 30, 90].map((days) => (
            <Button
              key={days}
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                request(
                  new URLSearchParams({
                    days: String(days),
                    ...(form.accountId ? { accountId: form.accountId } : {}),
                  }).toString(),
                )
              }
            >
              Últimos {days} días
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => request(ready ? formQuery() : query)}
          >
            <RefreshCw size={15} />
            Actualizar
          </Button>
        </div>
        <p className="analytics-help">
          Hasta 90 días. Las fechas usan la zona horaria de la empresa
          {report ? `: ${report.filters.timezone}` : ''}. Durante la carga, esperá para cambiar los
          filtros.
        </p>
        {!ready && !busy && (
          <p className="analytics-help">
            Los campos de fecha y canal estarán disponibles al cargar el informe. Podés reintentar
            con Actualizar.
          </p>
        )}
      </section>
      {busy && (
        <div role="status" className="analytics-card">
          Preparando el informe…
        </div>
      )}
      {error && (
        <div role="alert" className="analytics-card analytics-error">
          <h2>No pudimos mostrar el informe</h2>
          <p>{error}</p>
          <p>
            Los filtros se conservaron. Los datos anteriores se ocultan para evitar confundir
            períodos.
          </p>
          <Button variant="outline" onClick={() => request()}>
            Reintentar
          </Button>
        </div>
      )}
      {report && (
        <>
          {dirty && (
            <p className="analytics-help" role="status">
              Hay cambios en los filtros. Aplicá los filtros para actualizar el informe y habilitar
              la descarga.
            </p>
          )}
          <p className="analytics-help" role="status">
            Informe del {report.filters.from} al {report.filters.to} · Actualizado{' '}
            {new Intl.DateTimeFormat('es-AR', {
              dateStyle: 'short',
              timeStyle: 'short',
              timeZone: report.filters.timezone,
            }).format(new Date(report.asOf))}
            . Para ver cambios posteriores, actualizá.
          </p>
          {report.messages.inbound + report.messages.outbound === 0 && (
            <section className="analytics-card analytics-empty">
              <BarChart3 size={30} />
              <h2>Sin actividad en este período</h2>
              <p>
                No hay mensajes registrados para estos filtros. Probá otro período o revisá tus
                canales.
              </p>
              <Link href="/dashboard/canales">Ir a Canales →</Link>
            </section>
          )}
          <section aria-label="Resumen del período" className="analytics-metrics">
            <Metric
              title="Conversaciones con actividad"
              value={report.conversations.active}
              detail="Tuvieron al menos un mensaje registrado en el período."
            />
            <Metric
              title="Mensajes recibidos"
              value={report.messages.inbound}
              detail="Mensajes entrantes guardados en MONZO."
            />
            <Metric
              title="Envíos registrados"
              value={report.messages.outbound}
              detail="Incluye cola, aceptados, fallos, cancelaciones e inciertos."
            />
            <Metric
              title="Aceptados por Meta"
              value={report.messages.accepted}
              detail="Suma de estados enviado, entregado y leído. No significa que todos se hayan entregado."
            />
          </section>
          <section className="analytics-card">
            <h2>Conversaciones del período</h2>
            <p className="analytics-help">
              El estado de las conversaciones con actividad es el actual, no una reconstrucción
              histórica. «Nuevas» cuenta hilos creados en el período; reabrir uno no crea otro.
            </p>
            <dl className="analytics-inline">
              <div>
                <dt>Abiertas ahora</dt>
                <dd>{number(report.conversations.open)}</dd>
              </div>
              <div>
                <dt>Cerradas ahora</dt>
                <dd>{number(report.conversations.closed)}</dd>
              </div>
              <div>
                <dt>Abiertas sin asignar</dt>
                <dd>{number(report.conversations.unassigned)}</dd>
              </div>
              <div>
                <dt>Nuevas</dt>
                <dd>{number(report.conversations.new)}</dd>
              </div>
            </dl>
          </section>
          <section className="analytics-card">
            <div className="analytics-heading">
              <h2>Actividad por día</h2>
              <Button
                type="button"
                variant="outline"
                disabled={dirty}
                aria-describedby={dirty ? 'analytics-export-reason' : undefined}
                onClick={exportDays}
              >
                <Download size={15} />
                Descargar CSV diario
              </Button>
            </div>
            {dirty && (
              <p className="analytics-help" id="analytics-export-reason">
                Aplicá los filtros pendientes para habilitar esta descarga.
              </p>
            )}
            <p className="analytics-help">
              Fecha de registro en MONZO, en la zona horaria de la empresa. Los envíos registrados
              incluyen los que aún no se entregaron.
            </p>
            <ActivityChart days={report.days} />
            <details>
              <summary>Ver datos por día</summary>
              <div
                className="analytics-table-scroll"
                role="region"
                aria-label="Actividad diaria"
                tabIndex={0}
              >
                <table>
                  <caption className="sr-only">Mensajes por fecha</caption>
                  <thead>
                    <tr>
                      <th scope="col">Fecha</th>
                      <th scope="col">Recibidos</th>
                      <th scope="col">Envíos registrados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.days.map((day) => (
                      <tr key={day.date}>
                        <th scope="row">{day.date}</th>
                        <td>{number(day.inbound)}</td>
                        <td>{number(day.outbound)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
          <div className="analytics-columns">
            <section className="analytics-card">
              <h2>Estado actual de los envíos</h2>
              <p className="analytics-help">
                Envíos registrados en el período. Cada mensaje aparece en un solo estado; puede
                cambiar después. Un resultado incierto no confirma un fallo y no debe reenviarse
                automáticamente.
              </p>
              <dl className="analytics-statuses">
                {Object.entries(labels).map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{number(report.messages.statuses[key] ?? 0)}</dd>
                  </div>
                ))}
              </dl>
              <p className="analytics-help">
                Con entrega confirmada: {number(report.messages.delivered)} (entregados o leídos).
                Sin confirmación de lectura no significa que el cliente no lo haya leído.
              </p>
            </section>
            <section className="analytics-card">
              <h2>Actividad por canal</h2>
              <p className="analytics-help">
                Incluye canales desconectados y sus registros guardados.
              </p>
              {report.channels.length === 0 ? (
                <p>Todavía no hay canales.</p>
              ) : (
                report.channels.map((channel) => (
                  <article className="analytics-channel" key={channel.id}>
                    <h3>{channel.displayName}</h3>
                    <p>{channel.displayPhone}</p>
                    <dl className="analytics-inline">
                      <div>
                        <dt>Recibidos</dt>
                        <dd>{number(channel.inbound)}</dd>
                      </div>
                      <div>
                        <dt>Envíos</dt>
                        <dd>{number(channel.outbound)}</dd>
                      </div>
                      <div>
                        <dt>Aceptados</dt>
                        <dd>{number(channel.accepted)}</dd>
                      </div>
                      <div>
                        <dt>Fallidos / inciertos</dt>
                        <dd>
                          {number(channel.failed)} / {number(channel.unknown)}
                        </dd>
                      </div>
                    </dl>
                  </article>
                ))
              )}
            </section>
          </div>
          <section className="analytics-card">
            <h2>Resultados de los flujos</h2>
            <p className="analytics-help">
              Cuenta mensajes automáticos por número, incluyendo distintas versiones del flujo. Los
              resultados finales y derivaciones cuentan solo mensajes aceptados por Meta. No son
              recorridos únicos, conversiones ni casos resueltos; cancelar un mensaje no confirma
              que el cliente lo haya visto.
            </p>
            {report.flows.length === 0 ? (
              <p>No hay mensajes automáticos registrados en este período.</p>
            ) : (
              report.flows.map((flow) => (
                <article className="analytics-channel" key={flow.accountId}>
                  <h3>
                    {flow.displayName} · {flow.displayPhone}
                  </h3>
                  <dl className="analytics-inline">
                    <div>
                      <dt>Automáticos registrados</dt>
                      <dd>{number(flow.registered)}</dd>
                    </div>
                    <div>
                      <dt>Aceptados</dt>
                      <dd>{number(flow.accepted)}</dd>
                    </div>
                    <div>
                      <dt>Menús aceptados</dt>
                      <dd>{number(flow.menus)}</dd>
                    </div>
                    <div>
                      <dt>Preguntas de captura aceptadas</dt>
                      <dd>{number(flow.captures)}</dd>
                    </div>
                    <div>
                      <dt>Mensajes finales aceptados</dt>
                      <dd>{number(flow.finals)}</dd>
                    </div>
                    <div>
                      <dt>Avisos de derivación aceptados</dt>
                      <dd>{number(flow.handoffs)}</dd>
                    </div>
                    <div>
                      <dt>Pendientes</dt>
                      <dd>{number(flow.pending)}</dd>
                    </div>
                    <div>
                      <dt>Fallidos / inciertos</dt>
                      <dd>
                        {number(flow.failed)} / {number(flow.unknown)}
                      </dd>
                    </div>
                    <div>
                      <dt>Cancelados</dt>
                      <dd>{number(flow.canceled)}</dd>
                    </div>
                  </dl>
                </article>
              ))
            )}
          </section>
          <section className="analytics-card analytics-note">
            <h2>Cómo leer estos datos</h2>
            <p>
              Se cuenta cada mensaje guardado una sola vez. La fecha corresponde a su creación en
              MONZO, no al momento de entrega ni al de cierre de un hilo. Los recibos de Meta pueden
              actualizar estados después. No se calculan costos, tiempos históricos de atención ni
              tasas de resolución con información incompleta.
            </p>
            <p>
              El CSV contiene únicamente fechas y cantidades diarias. No incluye textos, teléfonos
              ni respuestas capturadas.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
function Metric({ title, value, detail }: { title: string; value: number; detail: string }) {
  return (
    <article className="analytics-card analytics-metric">
      <h2>{title}</h2>
      <strong>{number(value)}</strong>
      <p>{detail}</p>
    </article>
  );
}
function ActivityChart({ days }: { days: AnalyticsReport['days'] }) {
  const max = Math.max(1, ...days.flatMap((d) => [d.inbound, d.outbound]));
  const points = (key: 'inbound' | 'outbound') =>
    days
      .map(
        (day, index) =>
          `${days.length === 1 ? 350 : 24 + (index * 652) / (days.length - 1)},${136 - (day[key] * 116) / max}`,
      )
      .join(' ');
  return (
    <div className="analytics-chart">
      <div className="analytics-legend">
        <span>● Recibidos</span>
        <span>● Envíos registrados</span>
      </div>
      <svg
        viewBox="0 0 700 168"
        role="img"
        aria-label={`Actividad diaria. Máximo de la escala: ${number(max)} mensajes. Los valores exactos están en Ver datos por día.`}
      >
        <line x1="24" x2="676" y1="136" y2="136" stroke="#ccdde1" />
        <text x="4" y="14">
          {number(max)}
        </text>
        <text x="4" y="139">
          0
        </text>
        <polyline points={points('inbound')} fill="none" stroke="#007b85" strokeWidth="3" />
        <polyline
          points={points('outbound')}
          fill="none"
          stroke="#8054ac"
          strokeWidth="3"
          strokeDasharray="7 4"
        />
        {days.length === 1 && (
          <>
            <circle cx="350" cy={136 - (days[0].inbound * 116) / max} r="5" fill="#007b85" />
            <circle cx="350" cy={136 - (days[0].outbound * 116) / max} r="3" fill="#8054ac" />
          </>
        )}
        <text
          x={days.length === 1 ? 350 : 24}
          y="160"
          textAnchor={days.length === 1 ? 'middle' : 'start'}
        >
          {days[0]?.date}
        </text>
        {days.length > 1 && (
          <text x="676" y="160" textAnchor="end">
            {days.at(-1)?.date}
          </text>
        )}
      </svg>
    </div>
  );
}
