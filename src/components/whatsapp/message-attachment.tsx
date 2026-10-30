'use client';
import { useEffect, useState, useRef, type CSSProperties } from 'react';
import {
  Download,
  FileText,
  ImageIcon,
  LoaderCircle,
  Mic,
  Pause,
  Play,
  Video,
  X,
} from 'lucide-react';
import type { ChatMessage } from '@/modules/whatsapp/types';
import { mediaSizeLabel } from '@/modules/whatsapp/media-policy';

const wave = [
  10, 17, 12, 24, 30, 18, 12, 26, 35, 22, 14, 28, 20, 12, 30, 38, 24, 16, 28, 18, 12, 25, 34, 20,
  13, 27, 19, 11,
];
function durationLabel(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
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
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [speed, setSpeed] = useState(1);
  const download = useRef<AbortController | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const lightbox = useRef<HTMLDialogElement>(null);
  const pendingPlay = useRef(false);
  useEffect(() => () => download.current?.abort(), []);
  useEffect(
    () => () => {
      if (file) URL.revokeObjectURL(file.url);
    },
    [file],
  );
  async function playAudio() {
    if (!audio.current) return;
    try {
      if (audio.current.ended) audio.current.currentTime = 0;
      await audio.current.play();
    } catch {
      setPlaying(false);
    }
  }
  async function loadFile(play = false) {
    if (loading) return;
    setLoading(true);
    setError('');
    download.current = new AbortController();
    const signal = download.current.signal;
    pendingPlay.current = play;
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
      const encodedName = response.headers
        .get('content-disposition')
        ?.match(/filename\*=UTF-8''([^;]+)/)?.[1];
      const name = encodedName
        ? decodeURIComponent(encodedName)
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
      if (!signal.aborted)
        setError(cause instanceof Error ? cause.message : 'No pudimos abrir el archivo.');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }
  const save = file && (
    <a
      href={file.url}
      download={file.name}
      className="attachment-save"
      aria-label="Guardar archivo"
      title="Guardar archivo"
    >
      <Download size={16} />
    </a>
  );
  if (!message.hasMedia)
    return <p className="attachment-error">Este mensaje no tiene un archivo disponible.</p>;
  return (
    <div className={`message-attachment attachment-${message.type}`}>
      {message.type === 'audio' ? (
        <>
          <div className="voice-player">
            <button
              type="button"
              className="voice-play"
              aria-label={
                loading
                  ? 'Cargando audio'
                  : !file
                    ? 'Escuchar audio'
                    : playing
                      ? 'Pausar audio'
                      : 'Reproducir audio'
              }
              disabled={loading}
              onClick={() => {
                if (!file) void loadFile(true);
                else if (playing) audio.current?.pause();
                else void playAudio();
              }}
            >
              {loading ? (
                <LoaderCircle size={21} className="attachment-spinner" />
              ) : playing ? (
                <Pause size={21} fill="currentColor" />
              ) : (
                <Play size={21} fill="currentColor" />
              )}
            </button>
            <div className="voice-track">
              <div
                className="voice-wave"
                style={
                  {
                    '--voice-progress': `${duration ? Math.min(100, (position / duration) * 100) : 0}%`,
                  } as CSSProperties
                }
              >
                <span className="voice-bars" aria-hidden="true">
                  {wave.map((height, index) => (
                    <i
                      key={index}
                      className={
                        duration > 0 && index / wave.length < position / duration
                          ? 'played'
                          : undefined
                      }
                      style={{ height }}
                    />
                  ))}
                </span>
                <input
                  type="range"
                  min={0}
                  max={duration || 1}
                  step="0.01"
                  value={Math.min(position, duration || 1)}
                  disabled={!file || !duration}
                  aria-label="Posición del audio"
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (audio.current) audio.current.currentTime = value;
                    setPosition(value);
                  }}
                />
              </div>
              <div className="voice-meta">
                <span>
                  {file
                    ? durationLabel(position > 0 ? position : duration)
                    : loading
                      ? 'Cargando…'
                      : 'Nota de voz'}
                </span>
                {file && (
                  <button
                    type="button"
                    className="voice-speed"
                    aria-label={`Velocidad del audio: ${speed}x`}
                    onClick={() => {
                      const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
                      if (audio.current) audio.current.playbackRate = next;
                      setSpeed(next);
                    }}
                  >
                    {speed}×
                  </button>
                )}
              </div>
            </div>
            <span className="voice-mic" aria-hidden="true">
              <Mic size={21} />
            </span>
            {save}
          </div>
          {file && (
            <audio
              ref={audio}
              src={file.url}
              preload="metadata"
              aria-label="Audio de la conversación"
              className="voice-source"
              onLoadedMetadata={(event) => {
                const value = event.currentTarget.duration;
                setDuration(Number.isFinite(value) ? value : 0);
              }}
              onCanPlay={() => {
                if (pendingPlay.current) {
                  pendingPlay.current = false;
                  void playAudio();
                }
              }}
              onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => {
                setPlaying(false);
                setPosition(0);
              }}
              onError={() =>
                setError(
                  'No pudimos reproducir este audio. Podés descargarlo para escucharlo en otra aplicación.',
                )
              }
            />
          )}
        </>
      ) : message.type === 'document' ? (
        <div className="document-card">
          <span className="document-icon" aria-hidden="true">
            <FileText size={26} />
          </span>
          <span className="document-copy">
            <strong>{file?.name ?? message.mediaFilename ?? 'Documento'}</strong>
            <small>
              {message.mediaFilename?.split('.').at(-1)?.toUpperCase() ?? 'ARCHIVO'}
              {message.mediaSize != null ? ` · ${mediaSizeLabel(message.mediaSize)}` : ''}
            </small>
          </span>
          {file ? (
            save
          ) : (
            <button
              type="button"
              className="attachment-save"
              aria-label="Descargar documento"
              title="Descargar documento"
              disabled={loading}
              onClick={() => void loadFile()}
            >
              {loading ? (
                <LoaderCircle size={18} className="attachment-spinner" />
              ) : (
                <Download size={18} />
              )}
            </button>
          )}
        </div>
      ) : file ? (
        <div className="visual-media">
          {file.mime.startsWith('image/') ? (
            <>
              <button
                type="button"
                className="image-open"
                aria-label={message.type === 'sticker' ? 'Ampliar sticker' : 'Ampliar imagen'}
                onClick={() => lightbox.current?.showModal()}
              >
                {/* Authenticated object URL; optimization cannot forward the session. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={file.url}
                  alt={message.mediaFilename ?? 'Imagen de la conversación'}
                  className="attachment-image"
                />
              </button>
              <dialog
                ref={lightbox}
                className="media-lightbox"
                aria-label="Vista de imagen"
                onClick={(event) => {
                  if (event.target === event.currentTarget) event.currentTarget.close();
                }}
              >
                <header>
                  <span>{file.name}</span>
                  <div>
                    {save}
                    <button
                      type="button"
                      className="lightbox-close"
                      aria-label="Cerrar imagen"
                      onClick={() => lightbox.current?.close()}
                    >
                      <X size={24} />
                    </button>
                  </div>
                </header>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={file.url} alt={message.mediaFilename ?? 'Imagen de la conversación'} />
              </dialog>
            </>
          ) : (
            <video
              controls
              playsInline
              preload="metadata"
              src={file.url}
              aria-label="Video de la conversación"
              onError={() =>
                setError(
                  'No pudimos reproducir este video. Podés descargarlo para abrirlo en otra aplicación.',
                )
              }
            />
          )}
          <span className="visual-save">{save}</span>
        </div>
      ) : (
        <button
          type="button"
          className="visual-placeholder"
          aria-label={
            message.type === 'video'
              ? 'Ver video'
              : message.type === 'sticker'
                ? 'Ver sticker'
                : 'Ver imagen'
          }
          disabled={loading}
          onClick={() => void loadFile()}
        >
          <span className="visual-placeholder-icon">
            {message.type === 'video' ? (
              <Video size={35} strokeWidth={1.5} />
            ) : (
              <ImageIcon size={35} strokeWidth={1.5} />
            )}
          </span>
          <span className="visual-placeholder-label">
            {loading
              ? 'Cargando…'
              : message.type === 'video'
                ? 'Video'
                : message.type === 'sticker'
                  ? 'Sticker'
                  : 'Foto'}
            {message.mediaSize != null && <small>{mediaSizeLabel(message.mediaSize)}</small>}
          </span>
          <span className="visual-placeholder-download">
            {loading ? (
              <LoaderCircle size={18} className="attachment-spinner" />
            ) : (
              <Download size={18} />
            )}
          </span>
        </button>
      )}
      {error && (
        <p role="alert" className="attachment-error">
          {error}
        </p>
      )}
    </div>
  );
}
