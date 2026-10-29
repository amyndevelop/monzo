'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Send,
  StickyNote,
  MessageCircle,
  Search,
  CheckCheck,
  Clock3,
  AlertCircle,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { whatsappRequest } from './http';
import type { ChatSummary, ChatThread, ChatMessage, Channels } from '@/modules/whatsapp/types';
const labels: Record<string, string> = {
  QUEUED: 'En cola',
  SENDING: 'Enviando',
  SENT: 'Enviado',
  DELIVERED: 'Entregado',
  READ: 'Leído',
  FAILED: 'Falló',
  UNKNOWN: 'Envío sin confirmar',
  CANCELED: 'Cancelado',
  RECEIVED: 'Recibido',
};
function time(value: string) {
  return new Date(value).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}
function messageText(message: ChatMessage) {
  return (
    message.text ??
    {
      image: 'Imagen recibida',
      audio: 'Audio recibido',
      video: 'Video recibido',
      document: 'Documento recibido',
      sticker: 'Sticker recibido',
    }[message.type] ??
    'Mensaje recibido'
  );
}
export function Inbox({
  tenantId,
  userId,
  canAssign,
  initialConversation,
}: {
  tenantId: string;
  userId: string;
  canAssign: boolean;
  initialConversation?: string;
}) {
  const base = `/api/workspaces/${tenantId}`;
  const [items, setItems] = useState<ChatSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(initialConversation ?? null);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [channel, setChannel] = useState<Channels | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('OPEN');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'message' | 'note'>('message');
  const [listLoaded, setListLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const nonce = useRef<string | null>(null);
  const selectedRef = useRef(selected);
  function selectConversation(id: string | null) {
    selectedRef.current = id;
    setSelected(id);
    setThread(null);
    setDraft('');
    nonce.current = null;
  }
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const [result, channels] = await Promise.all([
          whatsappRequest<{ items: ChatSummary[]; hasMore: boolean }>(
            `${base}/conversations?q=${encodeURIComponent(query)}&status=${status}`,
            'GET',
            undefined,
            controller.signal,
          ),
          whatsappRequest<Channels>(
            base + '/whatsapp/accounts',
            'GET',
            undefined,
            controller.signal,
          ),
        ]);
        if (active) {
          setItems(result.items);
          setHasMore(result.hasMore);
          setChannel(channels);
          setListLoaded(true);
        }
      } catch (error) {
        if (active) {
          setItems([]);
          setError(
            error instanceof Error ? error.message : 'No pudimos cargar las conversaciones.',
          );
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [base, query, status]);
  const refreshThread = useCallback(async () => {
    if (!selected) return;
    const result = await whatsappRequest<ChatThread>(`${base}/conversations/${selected}`);
    if (selectedRef.current === selected)
      setThread((current) => {
        if (!current || current.conversation.id !== result.conversation.id) return result;
        const merged = new Map(current.messages.map((message) => [message.id, message]));
        for (const message of result.messages) merged.set(message.id, message);
        return {
          ...result,
          messages: [...merged.values()].sort(
            (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
          ),
          hasMore:
            current.messages.length > result.messages.length ? current.hasMore : result.hasMore,
        };
      });
  }, [base, selected]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    const controller = new AbortController();
    const load = async () => {
      try {
        const result = await whatsappRequest<ChatThread>(
          `${base}/conversations/${selected}`,
          'GET',
          undefined,
          controller.signal,
        );
        if (!active) return;
        setThread((current) => {
          if (!current || current.conversation.id !== result.conversation.id) return result;
          const merged = new Map(current.messages.map((message) => [message.id, message]));
          for (const message of result.messages) merged.set(message.id, message);
          return {
            ...result,
            messages: [...merged.values()].sort(
              (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
            ),
            hasMore:
              current.messages.length > result.messages.length ? current.hasMore : result.hasMore,
          };
        });
        const last = result.messages.at(-1);
        if (last && result.conversation.unreadCount > 0)
          await whatsappRequest(
            `${base}/conversations/${selected}`,
            'PATCH',
            { readThroughId: last.id },
            controller.signal,
          );
      } catch (error) {
        if (active) {
          setThread(null);
          setError(error instanceof Error ? error.message : 'No pudimos cargar la conversación.');
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [base, selected]);
  async function change(data: unknown) {
    if (!selected) return;
    setError('');
    try {
      await whatsappRequest(`${base}/conversations/${selected}`, 'PATCH', data);
      await refreshThread();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No pudimos guardar el cambio.');
    }
  }
  const openWindow = Boolean(thread?.canReply);
  return (
    <div className={`inbox ${selected ? 'inbox-has-selection' : ''}`}>
      <aside className="inbox-list">
        <div className="inbox-list-header">
          <div>
            <h2>Tu bandeja</h2>
            <span>Actualización automática</span>
          </div>
          <Link href="/dashboard/canales">Canales →</Link>
        </div>
        <label className="inbox-search">
          <Search size={16} />
          <span className="sr-only">Buscar conversaciones</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={80}
            placeholder="Buscar nombre o teléfono"
          />
        </label>
        <label className="inbox-filter">
          <span>Estado</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="OPEN">Abiertas</option>
            <option value="CLOSED">Cerradas</option>
            <option value="ALL">Todas</option>
          </select>
        </label>
        <div className="inbox-conversations">
          {!listLoaded ? (
            <p className="inbox-empty-small">Cargando conversaciones…</p>
          ) : items.length === 0 ? (
            <div className="inbox-empty-small">
              <MessageCircle size={24} />
              <strong>
                {query ? 'No encontramos coincidencias.' : 'Tu próximo hola aparece acá.'}
              </strong>
              <p>
                {channel?.accounts.some((a) => a.enabled)
                  ? 'Las conversaciones aparecerán al recibir mensajes por WhatsApp.'
                  : 'Conectá un número en Canales para empezar.'}
              </p>
            </div>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                className={`conversation-preview ${selected === item.id ? 'selected' : ''}`}
                onClick={() => {
                  selectConversation(item.id);
                  setError('');
                }}
              >
                <span className="contact-avatar">
                  {(item.contact.name ?? item.contact.waId).slice(0, 1)}
                </span>
                <span className="conversation-preview-copy">
                  <strong>{item.contact.name ?? '+' + item.contact.waId}</strong>
                  <small>{item.messages[0] ? messageText(item.messages[0]) : 'Sin mensajes'}</small>
                  <span>{item.account.displayPhone}</span>
                </span>
                <span className="conversation-preview-time">
                  {time(item.lastMessageAt)}
                  {item.unreadCount > 0 && <b>{item.unreadCount}</b>}
                </span>
              </button>
            ))
          )}
        </div>
        {hasMore && (
          <p className="inbox-limit">
            Mostrando las 100 conversaciones más recientes. Usá la búsqueda para encontrar otra.
          </p>
        )}
      </aside>
      <section className="inbox-thread">
        {!selected ? (
          <div className="inbox-empty">
            <span className="icon-tile">
              <MessageCircle size={32} />
            </span>
            <h2>Cada conversación cuenta.</h2>
            <p>
              Elegí una conversación para ver su historial
              <br />y acompañar al cliente desde acá.
            </p>
            <Link href="/dashboard/canales">Configurar WhatsApp →</Link>
          </div>
        ) : !thread ? (
          <div className="inbox-empty">
            <Button variant="ghost" onClick={() => selectConversation(null)}>
              <ArrowLeft size={16} />
              Volver a la bandeja
            </Button>
            <p>Cargando conversación…</p>
          </div>
        ) : (
          <>
            <header className="thread-header">
              <Button
                className="thread-back"
                variant="ghost"
                size="icon"
                aria-label="Volver a conversaciones"
                onClick={() => selectConversation(null)}
              >
                <ArrowLeft size={19} />
              </Button>
              <div>
                <h2>
                  {thread.conversation.contact.name ?? '+' + thread.conversation.contact.waId}
                </h2>
                <p>+{thread.conversation.contact.waId} · WhatsApp</p>
              </div>
              <Button
                variant="outline"
                onClick={() =>
                  void change({ status: thread.conversation.status === 'OPEN' ? 'CLOSED' : 'OPEN' })
                }
              >
                {thread.conversation.status === 'OPEN' ? 'Cerrar' : 'Reabrir'}
              </Button>
            </header>
            <div className="thread-tools">
              <label>
                <UserRound size={14} />
                <span className="sr-only">Operador asignado</span>
                <select
                  aria-label="Operador asignado"
                  value={thread.conversation.assignedUserId ?? ''}
                  onChange={(event) => void change({ assignedUserId: event.target.value || null })}
                >
                  <option value="">Sin asignar</option>
                  {thread.members
                    .filter(
                      (member) =>
                        canAssign ||
                        member.user.id === userId ||
                        member.user.id === thread.conversation.assignedUserId,
                    )
                    .map((member) => (
                      <option
                        key={member.user.id}
                        value={member.user.id}
                        disabled={!canAssign && member.user.id !== userId}
                      >
                        {member.user.name ?? 'Integrante'}
                      </option>
                    ))}
                </select>
              </label>
              <span className={openWindow ? 'window-open' : 'window-closed'}>
                <Clock3 size={13} />
                {openWindow ? 'Ventana de atención abierta' : 'Ventana de 24 h cerrada'}
              </span>
            </div>
            {channel && !channel.processorReady && (
              <p className="thread-notice">
                Los envíos están en pausa. Los mensajes en cola todavía no se enviaron.
              </p>
            )}
            <div
              className="thread-messages"
              role="log"
              aria-live="polite"
              aria-label="Historial de mensajes"
            >
              {thread.hasMore && (
                <Button
                  variant="ghost"
                  disabled={loadingHistory}
                  onClick={async () => {
                    const first = thread.messages[0];
                    if (!first || !selected) return;
                    setLoadingHistory(true);
                    try {
                      const older = await whatsappRequest<ChatThread>(
                        `${base}/conversations/${selected}?before=${first.id}`,
                      );
                      setThread((current) =>
                        current && current.conversation.id === selected
                          ? {
                              ...current,
                              messages: [...older.messages, ...current.messages],
                              hasMore: older.hasMore,
                            }
                          : current,
                      );
                    } catch {
                      setError('No pudimos cargar mensajes anteriores.');
                    } finally {
                      setLoadingHistory(false);
                    }
                  }}
                >
                  Cargar mensajes anteriores
                </Button>
              )}
              {thread.messages.map((message) => (
                <article
                  className={`chat-bubble ${message.direction === 'OUTBOUND' ? 'outgoing' : 'incoming'}`}
                  key={message.id}
                >
                  {message.type !== 'text' && (
                    <span className="media-limitation">
                      {message.type} · archivo sin vista previa en esta fase
                    </span>
                  )}
                  <p>{messageText(message)}</p>
                  <footer>
                    <time dateTime={message.occurredAt}>{time(message.occurredAt)}</time>
                    {message.direction === 'OUTBOUND' && (
                      <span className={`message-state state-${message.status.toLowerCase()}`}>
                        {['DELIVERED', 'READ'].includes(message.status) ? (
                          <CheckCheck size={13} />
                        ) : ['FAILED', 'UNKNOWN', 'CANCELED'].includes(message.status) ? (
                          <AlertCircle size={12} />
                        ) : null}
                        {labels[message.status] ?? message.status}
                      </span>
                    )}
                  </footer>
                  {message.status === 'UNKNOWN' && (
                    <small>
                      Meta no confirmó el resultado. Revisá la conversación antes de intentar otro
                      envío.
                    </small>
                  )}
                  {message.errorCode && <small>{message.errorCode}</small>}
                </article>
              ))}
            </div>
            <div className="thread-notes">
              {thread.notes.length > 0 && (
                <details>
                  <summary>
                    <StickyNote size={14} />
                    Últimas notas internas ({thread.notes.length})
                  </summary>
                  {thread.notes.map((note) => (
                    <article key={note.id}>
                      <strong>{note.author.name ?? 'Integrante'}</strong>
                      <p>{note.text}</p>
                      <time>{new Date(note.createdAt).toLocaleString('es-AR')}</time>
                    </article>
                  ))}
                </details>
              )}
            </div>
            <form
              className={`message-composer ${mode === 'note' ? 'note-composer' : ''}`}
              onSubmit={async (event) => {
                event.preventDefault();
                if (!selected || sending || !draft.trim()) return;
                setSending(true);
                setError('');
                try {
                  if (mode === 'note')
                    await whatsappRequest(`${base}/conversations/${selected}/notes`, 'POST', {
                      text: draft,
                    });
                  else {
                    nonce.current ??= crypto.randomUUID();
                    await whatsappRequest(`${base}/conversations/${selected}/messages`, 'POST', {
                      text: draft,
                      idempotencyKey: nonce.current,
                    });
                  }
                  setDraft('');
                  nonce.current = null;
                  await refreshThread();
                } catch (error) {
                  setError(
                    error instanceof Error ? error.message : 'No pudimos guardar el mensaje.',
                  );
                } finally {
                  setSending(false);
                }
              }}
            >
              <div className="composer-tabs">
                <button
                  type="button"
                  aria-pressed={mode === 'message'}
                  onClick={() => {
                    setMode('message');
                    setDraft('');
                    nonce.current = null;
                  }}
                >
                  Respuesta por WhatsApp
                </button>
                <button
                  type="button"
                  aria-pressed={mode === 'note'}
                  onClick={() => {
                    setMode('note');
                    setDraft('');
                    nonce.current = null;
                  }}
                >
                  Nota interna
                </button>
              </div>
              {mode === 'message' && !openWindow ? (
                <p className="closed-window-copy">
                  Para responder con texto necesitamos un mensaje del cliente en las últimas 24
                  horas. Las plantillas se incorporarán después.
                </p>
              ) : (
                <>
                  <label className="sr-only" htmlFor="chat-draft">
                    {mode === 'note' ? 'Nota interna' : 'Mensaje de WhatsApp'}
                  </label>
                  <textarea
                    id="chat-draft"
                    value={draft}
                    maxLength={mode === 'note' ? 2000 : 4096}
                    disabled={sending}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      nonce.current = null;
                    }}
                    placeholder={
                      mode === 'note'
                        ? 'Solo tu equipo podrá ver esta nota…'
                        : 'Escribí tu respuesta…'
                    }
                  />
                  <div className="composer-bottom">
                    <span>
                      {mode === 'note'
                        ? 'Solo visible para el equipo. No se envía por WhatsApp.'
                        : 'El mensaje quedará en cola hasta que Meta confirme el envío.'}
                    </span>
                    <Button type="submit" disabled={sending || !draft.trim()}>
                      {mode === 'note' ? <StickyNote size={15} /> : <Send size={15} />}{' '}
                      {sending ? 'Guardando…' : mode === 'note' ? 'Guardar nota' : 'Enviar'}
                    </Button>
                  </div>
                </>
              )}
            </form>
          </>
        )}
        {error && (
          <p role="alert" className="form-error inbox-error">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
