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
  Paperclip,
  X,
  FileText,
  LoaderCircle,
} from 'lucide-react';
import { ConversationFlowControl } from '@/components/automations/conversation-control';
import { Button } from '@/components/ui/button';
import { whatsappRequest } from './http';
import { MessageAttachment } from './message-attachment';
import { TemplateDialog } from './template-dialog';
import { TemplatePreview } from './template-preview';
import { InboxNavigationToggle } from '@/components/platform/inbox-navigation';
import { MEDIA_ACCEPT, MAX_MEDIA_BYTES, mediaSizeLabel } from '@/modules/whatsapp/media-policy';
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
const errorLabels: Record<string, string> = {
  TEMPLATE_NOT_APPROVED:
    'Meta pausó o dejó de aprobar esta plantilla. Elegí otra o actualizá el catálogo.',
  TEMPLATE_CHANGED:
    'La plantilla cambió. Abrí el selector y revisá la versión actual antes de enviar.',
  TEMPLATE_UNAVAILABLE: 'No pudimos comprobar la plantilla en Meta. Revisá el canal y el catálogo.',
  TEMPLATE_UNSUPPORTED: 'El formato de esta plantilla todavía no está disponible en la bandeja.',
  TEMPLATE_PARAMETERS: 'Los datos de la plantilla no son válidos. Revisalos antes de otro envío.',
  MEMBERSHIP_REVOKED: 'El operador ya no tiene acceso a esta empresa.',
  CREDENTIALS_UNAVAILABLE: 'Actualizá la autorización del canal en Canales.',
  ACCOUNT_DISABLED: 'El canal está desconectado. Revisá su autorización en Canales.',
  AUTOMATION_PAUSED: 'El flujo se pausó antes de enviar esta respuesta.',
  AUTOMATION_CHANGED: 'La versión del flujo cambió antes del envío.',
  AUTOMATION_ADVANCED: 'El cliente ya avanzó a otro paso del flujo.',
  META_190: 'La autorización de Meta venció o fue revocada. Actualizala en Canales.',
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
  const [templateOpen, setTemplateOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const draftInput = useRef<HTMLTextAreaElement>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );
  function clearAttachment() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setAttachmentPreview(null);
    setAttachment(null);
  }
  function chooseAttachment(file: File) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = ['image/jpeg', 'image/png'].includes(file.type) ? URL.createObjectURL(file) : null;
    previewRef.current = url;
    setAttachmentPreview(url);
    setAttachment(file);
  }
  const [mode, setMode] = useState<'message' | 'note'>('message');
  const [listLoaded, setListLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const nonce = useRef<string | null>(null);
  const selectedRef = useRef(selected);
  function selectConversation(id: string | null) {
    selectedRef.current = id;
    setSelected(id);
    setTemplateOpen(false);
    setThread(null);
    setDraft('');
    clearAttachment();
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
  const audioAttachment = Boolean(
    attachment &&
    (attachment.type.startsWith('audio/') || /\.(mp3|ogg|m4a|aac)$/i.test(attachment.name)),
  );
  return (
    <div className={`inbox ${selected ? 'inbox-has-selection' : ''}`}>
      <aside className="inbox-list">
        <div className="inbox-list-header">
          <InboxNavigationToggle />
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
                disabled={sending}
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
            <InboxNavigationToggle className="thread-navigation-toggle" />
            <Button variant="ghost" onClick={() => selectConversation(null)}>
              <ArrowLeft size={16} />
              Volver a la bandeja
            </Button>
            <p>Cargando conversación…</p>
          </div>
        ) : (
          <>
            <header className="thread-header">
              <InboxNavigationToggle className="thread-navigation-toggle" />
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
            <ConversationFlowControl
              key={thread.conversation.id}
              base={base}
              thread={thread}
              onChange={refreshThread}
            />
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
                  className={`chat-bubble kind-${message.type} ${message.text ? 'has-caption' : ''} ${message.direction === 'OUTBOUND' ? 'outgoing' : 'incoming'}`}
                  key={message.id}
                >
                  {['image', 'audio', 'video', 'document', 'sticker'].includes(message.type) && (
                    <MessageAttachment tenantId={tenantId} message={message} />
                  )}
                  {message.template ? (
                    <TemplatePreview
                      preview={message.template}
                      tenantId={tenantId}
                      message={message}
                    />
                  ) : message.text ? (
                    <p>{message.text}</p>
                  ) : message.type === 'text' ? (
                    <p>Mensaje sin texto</p>
                  ) : !['image', 'audio', 'video', 'document', 'sticker'].includes(message.type) ? (
                    <p>{messageText(message)}</p>
                  ) : null}
                  <footer>
                    {message.automation && (
                      <span className="flow-message-badge">Automatización</span>
                    )}
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
                  {message.errorCode && (
                    <small title={message.errorCode}>
                      {errorLabels[message.errorCode] ?? message.errorCode}
                    </small>
                  )}
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
                if (!selected || sending || (!draft.trim() && !(mode === 'message' && attachment)))
                  return;
                setSending(true);
                setError('');
                try {
                  if (mode === 'note')
                    await whatsappRequest(`${base}/conversations/${selected}/notes`, 'POST', {
                      text: draft,
                    });
                  else {
                    nonce.current ??= crypto.randomUUID();
                    if (attachment) {
                      const form = new FormData();
                      form.set('file', attachment);
                      form.set('text', draft);
                      form.set('idempotencyKey', nonce.current);
                      await whatsappRequest(
                        `${base}/conversations/${selected}/attachments`,
                        'POST',
                        form,
                      );
                    } else
                      await whatsappRequest(`${base}/conversations/${selected}/messages`, 'POST', {
                        text: draft,
                        idempotencyKey: nonce.current,
                      });
                  }
                  setDraft('');
                  if (draftInput.current) draftInput.current.style.height = 'auto';
                  clearAttachment();
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
                  disabled={sending}
                  aria-pressed={mode === 'message'}
                  onClick={() => {
                    setMode('message');
                    setDraft('');
                    clearAttachment();
                    nonce.current = null;
                  }}
                >
                  <MessageCircle size={13} /> WhatsApp
                </button>
                <button
                  type="button"
                  disabled={sending}
                  aria-pressed={mode === 'note'}
                  onClick={() => {
                    setMode('note');
                    setDraft('');
                    clearAttachment();
                    nonce.current = null;
                  }}
                >
                  <StickyNote size={13} /> Nota interna
                </button>
              </div>
              {mode === 'message' && !openWindow ? (
                <div className="closed-window-copy">
                  <p>
                    Pasaron más de 24 horas. Usá una plantilla aprobada para retomar la
                    conversación.
                  </p>
                  <Button type="button" variant="outline" onClick={() => setTemplateOpen(true)}>
                    <FileText size={16} /> Elegir plantilla
                  </Button>
                </div>
              ) : (
                <>
                  {mode === 'message' && (
                    <input
                      ref={fileInput}
                      tabIndex={-1}
                      type="file"
                      className="sr-only"
                      aria-label="Archivo adjunto"
                      accept={MEDIA_ACCEPT}
                      disabled={sending}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (!file) return;
                        if (!file.size || file.size > MAX_MEDIA_BYTES) {
                          setError('El archivo debe pesar entre 1 byte y 3 MB.');
                          return;
                        }
                        const isAudio =
                          file.type.startsWith('audio/') || /\.(mp3|ogg|m4a|aac)$/i.test(file.name);
                        if (isAudio && draft.trim()) {
                          setError(
                            'Los audios se envían sin leyenda. Enviá o quitá el texto antes de adjuntar un audio.',
                          );
                          return;
                        }
                        if (draft.length > 1024) {
                          setError(
                            'La leyenda de un archivo admite hasta 1024 caracteres. Acortá el texto antes de adjuntarlo.',
                          );
                          return;
                        }
                        chooseAttachment(file);
                        nonce.current = null;
                        setError('');
                      }}
                    />
                  )}
                  {attachment && (
                    <div className="composer-file-preview">
                      <span className="composer-file-thumb">
                        {attachmentPreview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={attachmentPreview} alt="Vista previa del adjunto" />
                        ) : (
                          <FileText size={23} />
                        )}
                      </span>
                      <span>
                        <strong>{attachment.name}</strong>
                        <small>
                          {mediaSizeLabel(attachment.size)} ·{' '}
                          {audioAttachment ? 'Audio sin leyenda' : 'Agregá una leyenda si querés'}
                        </small>
                      </span>
                      <button
                        type="button"
                        disabled={sending}
                        className="composer-icon"
                        aria-label="Quitar adjunto"
                        title="Quitar adjunto"
                        onClick={() => {
                          clearAttachment();
                          nonce.current = null;
                        }}
                      >
                        <X size={18} />
                      </button>
                    </div>
                  )}
                  <div className="composer-row">
                    {mode === 'message' && (
                      <button
                        type="button"
                        className="composer-icon"
                        aria-label="Usar plantilla"
                        title="Usar una plantilla de WhatsApp"
                        disabled={sending}
                        onClick={() => setTemplateOpen(true)}
                      >
                        <FileText size={21} />
                      </button>
                    )}
                    {mode === 'message' && (
                      <button
                        type="button"
                        className="composer-icon composer-clip"
                        aria-label="Adjuntar archivo"
                        title="Adjuntar archivo · Hasta 3 MB"
                        disabled={sending}
                        onClick={() => fileInput.current?.click()}
                      >
                        <Paperclip size={22} />
                      </button>
                    )}
                    <div className="composer-field">
                      <label className="sr-only" htmlFor="chat-draft">
                        {mode === 'note' ? 'Nota interna' : 'Mensaje de WhatsApp'}
                      </label>
                      <textarea
                        id="chat-draft"
                        ref={draftInput}
                        rows={1}
                        value={draft}
                        maxLength={mode === 'note' ? 2000 : attachment ? 1024 : 4096}
                        disabled={sending || audioAttachment}
                        onChange={(event) => {
                          setDraft(event.target.value);
                          nonce.current = null;
                          event.target.style.height = 'auto';
                          event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
                        }}
                        onKeyDown={(event) => {
                          if (
                            event.key === 'Enter' &&
                            !event.shiftKey &&
                            !event.nativeEvent.isComposing &&
                            !window.matchMedia('(pointer: coarse)').matches
                          ) {
                            event.preventDefault();
                            event.currentTarget.form?.requestSubmit();
                          }
                        }}
                        placeholder={
                          mode === 'note'
                            ? 'Escribí una nota para tu equipo…'
                            : audioAttachment
                              ? 'Audio listo para enviar'
                              : 'Escribí un mensaje…'
                        }
                      />
                    </div>
                    <button
                      type="submit"
                      className="composer-send"
                      aria-label={mode === 'note' ? 'Guardar nota' : 'Enviar'}
                      title={mode === 'note' ? 'Guardar nota' : 'Enviar'}
                      disabled={sending || (!draft.trim() && !(mode === 'message' && attachment))}
                    >
                      {sending ? (
                        <LoaderCircle size={21} className="attachment-spinner" />
                      ) : mode === 'note' ? (
                        <StickyNote size={20} />
                      ) : (
                        <Send size={21} />
                      )}
                    </button>
                  </div>
                  {mode === 'note' && (
                    <p className="composer-private-hint">
                      <StickyNote size={11} />
                      Solo tu equipo puede ver esta nota.
                    </p>
                  )}
                </>
              )}
            </form>
          </>
        )}
        {templateOpen && selected && thread && (
          <TemplateDialog
            key={selected}
            base={`${base}/conversations/${selected}`}
            contactName={thread.conversation.contact.name ?? '+' + thread.conversation.contact.waId}
            onClose={() => setTemplateOpen(false)}
            onSent={() => {
              void refreshThread().catch(() =>
                setError('La plantilla quedó guardada. Actualizá el chat para ver su estado.'),
              );
            }}
          />
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
