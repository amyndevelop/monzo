// Shared product limits; provider-specific checks live only on the server.
export const MAX_MEDIA_BYTES = 3 * 1024 * 1024;
export const MEDIA_ACCEPT =
  '.jpg,.jpeg,.png,.pdf,.mp3,.ogg,.m4a,.aac,.mp4,.3gp,.docx,.xlsx,.pptx,.txt';
export type MediaKind = 'image' | 'audio' | 'video' | 'document' | 'sticker';
export function mediaSizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const unit = bytes < 1024 * 1024 ? 'KB' : 'MB';
  return `${(bytes / (unit === 'KB' ? 1024 : 1024 * 1024)).toLocaleString('es-AR', { maximumFractionDigits: 1 })} ${unit}`;
}
export function safeFilename(value: string) {
  return (
    value
      .normalize('NFKC')
      .replace(/[\p{Cc}\p{Cf}/\\"<>:]/gu, '_')
      .slice(0, 120)
      .trim() || 'archivo'
  );
}
