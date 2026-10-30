'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, X, Search, RefreshCw, Send, FileText, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { whatsappRequest } from './http';
import { TemplatePreview } from './template-preview';
import { Button } from '@/components/ui/button';
import { MAX_MEDIA_BYTES, mediaSizeLabel } from '@/modules/whatsapp/media-policy';
import {
  renderTemplatePreview,
  templateStatusLabels,
  templateCategoryLabels,
  templateLanguageLabel,
  type TemplateCatalog,
  type TemplateItem,
} from '@/modules/whatsapp/template-types';

export function TemplateDialog({
  base,
  contactName,
  onClose,
  onSent,
}: {
  base: string;
  contactName: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const selectedRef = useRef<TemplateItem | null>(null);
  const nonce = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const [catalog, setCatalog] = useState<TemplateCatalog | null>(null);
  const [selected, setSelected] = useState<TemplateItem | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState('');
  const [status, setStatus] = useState('APPROVED');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [mobileDetail, setMobileDetail] = useState(false);
  const busy = syncing || sending;
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement;
    element.showModal();
    element.querySelector<HTMLInputElement>('[aria-label="Buscar plantilla"]')?.focus();
    return () => {
      request.current?.abort();
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    if (!mobileDetail) return;
    const frame = requestAnimationFrame(() => {
      dialog.current?.querySelector<HTMLElement>('.template-editor-heading h3')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [mobileDetail]);
  const fileUrlRef = useRef<string | null>(null);
  function chooseFile(chosen: File | null) {
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    const url =
      chosen && ['image/jpeg', 'image/png', 'video/mp4', 'video/3gpp'].includes(chosen.type)
        ? URL.createObjectURL(chosen)
        : null;
    fileUrlRef.current = url;
    setFile(chosen);
    setFileUrl(url);
  }
  useEffect(
    () => () => {
      if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    },
    [],
  );
  const load = useCallback(
    async (after?: string) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setLoading(true);
      const params = new URLSearchParams({ q: query, language, status });
      if (after) params.set('after', after);
      if (selectedRef.current) params.set('selected', selectedRef.current.id);
      try {
        const result = await whatsappRequest<TemplateCatalog>(
          `${base}/templates?${params}`,
          'GET',
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setCatalog((current) => ({
          ...result,
          items: after && current ? [...current.items, ...result.items] : result.items,
        }));
        if (selectedRef.current && result.selection?.id === selectedRef.current.id) {
          if (selectedRef.current.definitionHash !== result.selection.definitionHash) {
            setValues({});
            chooseFile(null);
            nonce.current = null;
            setError(
              'La plantilla cambió en Meta. Revisá la vista previa y completá sus datos nuevamente.',
            );
          }
          selectedRef.current = result.selection;
          setSelected(result.selection);
        } else if (selectedRef.current) {
          selectedRef.current = null;
          setSelected(null);
          setMobileDetail(false);
          setError('La plantilla ya no está disponible para este canal. Elegí otra.');
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : 'No pudimos cargar las plantillas.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [base, query, language, status],
  );
  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => {
      clearTimeout(timer);
      request.current?.abort();
    };
  }, [load]);
  const definition = selected?.definition;
  const needsMedia = Boolean(
    definition && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(definition.header.format),
  );
  const missing = definition?.parameters.filter((param) => !values[param.key]?.trim()).length ?? 0;
  const invalid = definition?.parameters.some((param) => {
    const value = values[param.key] ?? '';
    return (
      value.length > param.maxLength ||
      /[\n\r\t]| {5}/.test(value) ||
      (param.component === 'button' && /[\s<>"{}]/.test(value))
    );
  });
  const preview = definition ? renderTemplatePreview(definition, values) : null;
  const tooLong = Boolean(
    preview &&
    (preview.body.length > 4096 ||
      (preview.header.format === 'TEXT' && preview.header.text.length > 60)),
  );
  const blocked = !catalog?.enabled
    ? 'Actualizá la autorización del canal para enviar.'
    : selected?.status !== 'APPROVED'
      ? 'Solo se pueden enviar plantillas aprobadas por Meta.'
      : (definition?.unsupportedReason ?? null);
  const reason =
    blocked ??
    (missing
      ? `Completá ${missing} ${missing === 1 ? 'dato' : 'datos'} para enviar.`
      : needsMedia && !file
        ? 'Agregá el archivo del encabezado para enviar.'
        : invalid
          ? 'Usá datos en una sola línea, sin tabulaciones ni espacios repetidos. Los enlaces no admiten espacios.'
          : tooLong
            ? 'El texto completo supera el largo permitido. Acortá los datos.'
            : null);
  async function sync(mode: 'refresh' | 'next') {
    setSyncing(true);
    setError('');
    request.current?.abort();
    try {
      await whatsappRequest(`${base}/templates/sync`, 'POST', { mode });
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No pudimos actualizar las plantillas.');
    } finally {
      setSyncing(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={`template-dialog ${mobileDetail ? 'template-detail-open' : ''}`}
      aria-labelledby="template-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="template-dialog-header">
        <button
          type="button"
          className="composer-icon template-back"
          aria-label="Volver a plantillas"
          disabled={busy}
          onClick={() => {
            setMobileDetail(false);
            requestAnimationFrame(() =>
              dialog.current
                ?.querySelector<HTMLButtonElement>('.template-choice.selected')
                ?.focus(),
            );
          }}
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h2 id="template-title">Enviar una plantilla</h2>
          <p>Para {contactName}</p>
        </div>
        <button
          className="composer-icon"
          aria-label="Cerrar plantillas"
          disabled={busy}
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </header>
      <div className="template-dialog-content">
        <aside className="template-catalog" aria-label="Catálogo de plantillas">
          <div className="template-filters">
            <label className="template-search">
              <Search size={17} />
              <input
                autoFocus
                aria-label="Buscar plantilla"
                value={query}
                maxLength={80}
                placeholder="Buscar plantilla…"
                disabled={busy}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div>
              <select
                aria-label="Estado de la plantilla"
                value={status}
                disabled={busy}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="APPROVED">Aprobadas</option>
                <option value="ALL">Todos los estados</option>
              </select>
              <select
                aria-label="Idioma de la plantilla"
                value={language}
                disabled={busy}
                onChange={(event) => setLanguage(event.target.value)}
              >
                <option value="">Todos los idiomas</option>
                {catalog?.languages.map((code) => (
                  <option key={code} value={code}>
                    {templateLanguageLabel(code)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="template-catalog-meta">
            <span>
              {loading
                ? 'Buscando…'
                : `${catalog?.total ?? 0} ${catalog?.total === 1 ? 'plantilla' : 'plantillas'}`}
            </span>
            {catalog?.canSync && (
              <button
                type="button"
                disabled={busy || loading || !catalog.enabled}
                onClick={() => void sync('refresh')}
                title="Consultar las plantillas de esta cuenta en Meta"
              >
                <RefreshCw size={13} className={syncing ? 'attachment-spinner' : ''} />
                {syncing ? 'Actualizando…' : 'Actualizar'}
              </button>
            )}
          </div>
          {catalog?.blockedReason && (
            <p className="form-error" role="status">
              {catalog.blockedReason}
            </p>
          )}
          {catalog && !catalog.canSync && (
            <p className="channel-footnote">
              Solo un administrador o propietario puede actualizar el catálogo.
            </p>
          )}
          <div className="template-catalog-list" aria-busy={loading || syncing}>
            {!catalog && loading ? (
              <p className="template-empty">Cargando plantillas…</p>
            ) : catalog?.items.length ? (
              catalog.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`template-choice ${selected?.id === item.id ? 'selected' : ''}`}
                  aria-pressed={selected?.id === item.id}
                  disabled={busy || loading}
                  onClick={() => {
                    if (selected?.id !== item.id) {
                      setValues({});
                      chooseFile(null);
                      nonce.current = null;
                    }
                    selectedRef.current = item;
                    setSelected(item);
                    setMobileDetail(true);
                    setError('');
                  }}
                >
                  <strong>{item.name.replaceAll('_', ' ')}</strong>
                  <span>
                    {templateLanguageLabel(item.language)} ·{' '}
                    {templateCategoryLabels[item.category] ?? item.category}
                  </span>
                  <small
                    className={`template-status ${item.status === 'APPROVED' ? 'approved' : ''}`}
                  >
                    {templateStatusLabels[item.status] ?? item.status}
                  </small>
                </button>
              ))
            ) : (
              <div className="template-empty">
                <FileText size={28} />
                <strong>
                  {query || language
                    ? 'No encontramos coincidencias'
                    : status === 'APPROVED'
                      ? 'Todavía no hay plantillas aprobadas'
                      : 'Tu catálogo está vacío'}
                </strong>
                <p>
                  {catalog?.blockedReason
                    ? 'Podés consultar las plantillas guardadas. Para traer las de Meta, primero resolvé la conexión en Canales.'
                    : catalog?.canSync
                      ? 'Usá Actualizar para traer las de Meta o probá con otro filtro.'
                      : 'Pedile a un administrador que actualice el catálogo desde Meta.'}
                </p>
                {catalog?.canSync && (
                  <a
                    href="https://business.facebook.com/wa/manage/message-templates/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Administrar en Meta ↗
                  </a>
                )}
              </div>
            )}
            {catalog?.nextPage && (
              <Button
                variant="ghost"
                disabled={loading || busy}
                onClick={() => void load(catalog.nextPage!)}
              >
                Ver más resultados
              </Button>
            )}
            {catalog?.canSync && catalog.hasMore && (
              <div className="template-more">
                <p>Quedan plantillas por traer desde Meta.</p>
                <Button
                  variant="outline"
                  disabled={busy || loading || !catalog.enabled}
                  onClick={() => void sync('next')}
                >
                  Traer más plantillas
                </Button>
              </div>
            )}
          </div>
          <p className="template-sync-time">
            {catalog?.syncedAt
              ? `Última actualización completa: ${new Date(catalog.syncedAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}`
              : 'El catálogo se actualiza al pulsar Actualizar.'}
          </p>
        </aside>
        <form
          className="template-editor"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!selected || busy || loading || reason) return;
            setSending(true);
            setError('');
            nonce.current ??= crypto.randomUUID();
            const payload = {
              templateId: selected.id,
              definitionHash: selected.definitionHash,
              values,
              idempotencyKey: nonce.current,
            };
            try {
              const form = file ? new FormData() : null;
              if (form && file) {
                form.set('payload', JSON.stringify(payload));
                form.set('file', file);
              }
              await whatsappRequest(`${base}/template-messages`, 'POST', form ?? payload);
              onSent();
              onClose();
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : 'No pudimos guardar la plantilla. Tus datos se conservaron.',
              );
            } finally {
              setSending(false);
            }
          }}
        >
          <div className="template-editor-scroll">
            {!selected || !definition || !preview ? (
              <div className="template-empty template-intro">
                <FileText size={34} />
                <h3>Un mensaje listo para cada momento</h3>
                <p>
                  Elegí una plantilla y completá los datos. Podés usarla aunque hayan pasado más de
                  24 horas desde el último mensaje del cliente.
                </p>
              </div>
            ) : (
              <>
                <div className="template-editor-heading">
                  <h3 tabIndex={-1}>{selected.name.replaceAll('_', ' ')}</h3>
                  <span>
                    {templateLanguageLabel(selected.language)} ·{' '}
                    {templateStatusLabels[selected.status] ?? selected.status}
                  </span>
                </div>
                {blocked && (
                  <p className="template-warning">
                    {blocked}
                    {!catalog?.enabled && (
                      <>
                        {' '}
                        <Link href="/dashboard/canales">Ir a Canales</Link>
                      </>
                    )}
                  </p>
                )}
                {!blocked && (
                  <fieldset disabled={busy || loading} className="template-fields">
                    <legend>
                      {definition.parameters.length || needsMedia
                        ? 'Completá el mensaje'
                        : 'Esta plantilla está lista para enviar'}
                    </legend>
                    {definition.parameters.map((param) => (
                      <label key={param.key}>
                        <span>
                          {param.label}{' '}
                          <small>
                            {param.component === 'header'
                              ? 'Encabezado'
                              : param.component === 'button'
                                ? 'Enlace'
                                : 'Mensaje'}
                          </small>
                        </span>
                        <input
                          required
                          value={values[param.key] ?? ''}
                          maxLength={param.maxLength}
                          placeholder={param.example ? `Ej.: ${param.example}` : 'Escribí el dato'}
                          onChange={(event) => {
                            setValues((current) => ({
                              ...current,
                              [param.key]: event.target.value,
                            }));
                            nonce.current = null;
                          }}
                        />
                        <small>Máximo {param.maxLength} caracteres</small>
                      </label>
                    ))}
                    {needsMedia && (
                      <div className="template-file">
                        <span>
                          {definition.header.format === 'IMAGE'
                            ? 'Imagen del encabezado'
                            : definition.header.format === 'VIDEO'
                              ? 'Video del encabezado'
                              : 'PDF del encabezado'}
                        </span>
                        <input
                          ref={fileInput}
                          className="sr-only"
                          tabIndex={-1}
                          type="file"
                          aria-label="Archivo del encabezado"
                          accept={
                            definition.header.format === 'IMAGE'
                              ? 'image/jpeg,image/png'
                              : definition.header.format === 'VIDEO'
                                ? 'video/mp4,video/3gpp'
                                : 'application/pdf'
                          }
                          onChange={(event) => {
                            const chosen = event.target.files?.[0];
                            event.target.value = '';
                            if (!chosen) return;
                            const accepted =
                              definition.header.format === 'IMAGE'
                                ? ['image/jpeg', 'image/png']
                                : definition.header.format === 'VIDEO'
                                  ? ['video/mp4', 'video/3gpp']
                                  : ['application/pdf'];
                            if (
                              !chosen.size ||
                              chosen.size > MAX_MEDIA_BYTES ||
                              !accepted.includes(chosen.type)
                            ) {
                              setError('Elegí un archivo del tipo indicado, de hasta 3 MB.');
                              return;
                            }
                            chooseFile(chosen);
                            nonce.current = null;
                            setError('');
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => fileInput.current?.click()}
                        >
                          <FileText size={16} />
                          {file ? 'Cambiar archivo' : 'Elegir archivo'}
                        </Button>
                        <small>
                          {file
                            ? `${file.name} · ${mediaSizeLabel(file.size)}`
                            : 'Hasta 3 MB. Se enviará como parte de la plantilla.'}
                        </small>
                        {file && (
                          <button
                            type="button"
                            onClick={() => {
                              chooseFile(null);
                              nonce.current = null;
                            }}
                          >
                            Quitar archivo
                          </button>
                        )}
                      </div>
                    )}
                  </fieldset>
                )}
                <div className="template-preview-area">
                  <h4>Así se verá el mensaje</h4>
                  <TemplatePreview preview={preview} file={file} fileUrl={fileUrl} />
                </div>
              </>
            )}
          </div>
          <footer className="template-send-footer">
            <p>
              {selected && reason
                ? reason
                : 'Meta puede aplicar cargos según la categoría y el país del destinatario.'}
            </p>
            <Button type="submit" disabled={!selected || busy || loading || Boolean(reason)}>
              {sending ? (
                <LoaderCircle size={17} className="attachment-spinner" />
              ) : (
                <Send size={17} />
              )}
              {sending ? 'Guardando…' : 'Enviar plantilla'}
            </Button>
          </footer>
        </form>
      </div>
      {error && (
        <div role="alert" className="template-error">
          <span>{error}</span>
          <button
            disabled={busy}
            onClick={() => {
              setError('');
              void load();
            }}
          >
            Revisar catálogo
          </button>
        </div>
      )}
    </dialog>
  );
}
