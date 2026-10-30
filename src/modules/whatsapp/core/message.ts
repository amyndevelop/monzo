import type { Prisma } from '@prisma/client';

export const messageFields = {
  id: true,
  direction: true,
  status: true,
  type: true,
  text: true,
  occurredAt: true,
  createdAt: true,
  errorCode: true,
  mediaId: true,
  mediaMimeType: true,
  mediaFilename: true,
  mediaSize: true,
} as const;
export function presentMessage(
  message: Prisma.MessageGetPayload<{ select: typeof messageFields }>,
) {
  return {
    id: message.id,
    direction: message.direction,
    status: message.status,
    type: message.type,
    text: message.text,
    occurredAt: message.occurredAt,
    createdAt: message.createdAt,
    errorCode: message.errorCode,
    mediaMimeType: message.mediaMimeType,
    mediaFilename: message.mediaFilename,
    mediaSize: message.mediaSize,
    hasMedia: Boolean(message.mediaId),
  };
}
