'use client';
import { useEffect, useState, useRef } from 'react';
import { Download, FileText, ImageIcon, LoaderCircle, Music2, Video } from 'lucide-react';
import type { ChatMessage } from '@/modules/whatsapp/types';
import { Button } from '@/components/ui/button';
import { mediaSizeLabel } from '@/modules/whatsapp/media-policy';

const titles: Record<string, string> = {
  image: 'Ver imagen',
  sticker: 'Ver sticker',
  audio: 'Escuchar audio',
  video: 'Ver video',
  document: 'Descargar documento',
};
export function MessageAttachment({
  tenantId,
  message,
}: {
  tenantId: string;
  message: ChatMessage;
}) {
  const [file, setFile] = useState<{ url: string; mime: string; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const download = useRef<AbortController | null>(null);
  useEffect(() => () => download.current?.abort(), []);
  useEffect(
    () => () => {
      if (file) URL.revokeObjectURL(file.url);
    },
    [file],
  );
  const Icon =
    message.type === 'audio'
      ? Music2
      : message.type === 'video'
        ? Video
        : message.type === 'document'
          ? FileText
          : ImageIcon;
  if (!message.hasMedia)
    return <p className="attachment-error">Este mensaje no tiene un archivo disponible.</p>;
  return (
    <div className="message-attachment">
      {file ? (
        <>
          {file.mime.startsWith('image/') ? (
            // Authenticated, bounded object URL; Next image optimization cannot forward the user's session.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={file.url}
              alt={message.mediaFilename ?? 'Imagen de la conversación'}
              className="attachment-image"
            />
          ) : file.mime.startsWith('audio/') ? (
            <audio
              controls
              preload="metadata"
              src={file.url}
              aria-label="Audio de la conversación"
              onError={() =>
                setError(
                  'El navegador no pudo reproducir el audio. Podés guardar el archivo para abrirlo en otra aplicación.',
                )
              }
            />
          ) : file.mime.startsWith('video/') ? (
            <video
              controls
              playsInline
              preload="metadata"
              src={file.url}
              aria-label="Video de la conversación"
              onError={() =>
                setError(
                  'El navegador no pudo reproducir el video. Podés guardar el archivo para abrirlo en otra aplicación.',
                )
              }
            />
          ) : (
            <span className="attachment-document">
              <FileText size={24} />
              {file.name}
            </span>
          )}
          <a href={file.url} download={file.name} className="attachment-download">
            <Download size={14} />
            Guardar archivo
          </a>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="attachment-load"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            setError('');
            download.current = new AbortController();
            const signal = download.current.signal;
            try {
              const response = await fetch(
                `/api/workspaces/${tenantId}/messages/${message.id}/attachment`,
                { cache: 'no-store', signal },
              );
              if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error ?? 'No pudimos abrir el archivo.');
              }
              const blob = await response.blob();
              if (signal.aborted) return;
              const disposition = response.headers
                .get('content-disposition')
                ?.match(/filename\*=UTF-8''([^;]+)/)?.[1];
              const name = disposition
                ? decodeURIComponent(disposition)
                : (message.mediaFilename ?? 'archivo');
              const url = URL.createObjectURL(blob);
              setFile({ url, mime: blob.type, name });
              if (message.type === 'document') {
                const link = document.createElement('a');
                link.href = url;
                link.download = name;
                document.body.append(link);
                link.click();
                link.remove();
              }
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'No pudimos abrir el archivo.');
            } finally {
              setLoading(false);
            }
          }}
        >
          {loading ? <LoaderCircle size={17} className="attachment-spinner" /> : <Icon size={17} />}
          {loading ? 'Abriendo…' : (titles[message.type] ?? 'Abrir archivo')}
        </Button>
      )}
      {!file && message.mediaFilename && (
        <small className="attachment-filename">{message.mediaFilename}</small>
      )}
      {message.mediaSize != null && (
        <small className="attachment-size">{mediaSizeLabel(message.mediaSize)}</small>
      )}
      {error && (
        <p role="alert" className="attachment-error">
          {error}
        </p>
      )}
    </div>
  );
}
