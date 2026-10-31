'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { whatsappRequest } from '@/components/whatsapp/http';
import type { ChatThread } from '@/modules/whatsapp/types';
export function ConversationFlowControl({
  base,
  thread,
  onChange,
}: {
  base: string;
  thread: ChatThread;
  onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const flow = thread.automation;
  if (!flow) return null;
  const human = flow.paused || flow.state === 'handoff' || flow.state === 'blocked';
  const blocked = !flow.enabled
    ? 'El flujo del número está pausado. Activalo en Automatizaciones.'
    : thread.conversation.assignedUserId
      ? 'Un operador autorizado debe quitar la asignación antes de reanudar.'
      : thread.conversation.status !== 'OPEN'
        ? 'Reabrí la conversación antes de reanudar.'
        : '';
  return (
    <div className="flow-chat-control">
      <span>
        {!flow.enabled
          ? 'Flujo del número pausado'
          : human
            ? 'Atención humana'
            : 'Flujo guiado activo'}
      </span>
      <Button
        type="button"
        variant="outline"
        disabled={busy || (human && Boolean(blocked))}
        onClick={async () => {
          setBusy(true);
          setError('');
          setNotice('');
          try {
            await whatsappRequest(
              `${base}/conversations/${thread.conversation.id}/automation`,
              'POST',
              { action: human ? 'resume' : 'pause' },
            );
            setNotice(
              human
                ? 'El flujo comenzará con el próximo mensaje del cliente.'
                : 'Atención humana activada. Los envíos ya iniciados pueden completarse.',
            );
            await onChange();
          } catch (error) {
            setError(error instanceof Error ? error.message : 'No pudimos cambiar el flujo.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Actualizando…' : human ? 'Reanudar flujo' : 'Tomar atención'}
      </Button>
      {!human && flow.enabled && (
        <small>Responder o asignar un operador también pausa el flujo.</small>
      )}
      {human && blocked && <small>{blocked}</small>}
      {flow.variables && Object.keys(flow.variables).length > 0 && (
        <details>
          <summary>Respuestas guardadas ({Object.keys(flow.variables).length})</summary>
          <dl>
            {Object.entries(flow.variables).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {flow.reason && <small>{flow.reason}</small>}
      {error && <small role="alert">{error}</small>}
      {notice && <small role="status">{notice}</small>}
    </div>
  );
}
