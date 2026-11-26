import { z } from 'zod';
import { secretPattern } from '../../../services/evolution-gateway/protocol.mjs';

const identity = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const phone = z.string().regex(/^[1-9][0-9]{5,14}$/);
const milliseconds = z.number().int().safe().positive();
const providerId = z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/);
export const evolutionScopeSchema = z
  .object({
    tenantId: identity,
    accountId: identity,
    generation: z.number().int().min(1).max(2147483647),
    expectedPhone: phone,
  })
  .strict();
const verified = { verifiedPhone: phone, verifiedAt: milliseconds };
export const evolutionPayloadSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('connection'),
      state: z.enum(['DISCONNECTED', 'CONNECTING', 'QR', 'CONNECTED', 'DISCONNECTING', 'ERROR']),
      observedAt: milliseconds,
      connectedPhone: phone.optional(),
      qr: z
        .string()
        .min(1)
        .max(4096)
        .regex(/^[^\p{Cc}]+$/u)
        .optional(),
      qrExpiresAt: milliseconds.optional(),
      code: z
        .enum([
          'NUMBER_MISMATCH',
          'INSTANCE_IDENTITY_UNAVAILABLE',
          'INSTANCE_UNREACHABLE',
          'QR_NOT_READY',
          'INSTANCE_RESULT_UNKNOWN',
          'INSTANCE_REJECTED',
          'EVOLUTION_AUTH',
          'PROCESS_INTERRUPTED',
        ])
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('message'),
      ...verified,
      providerId,
      peer: phone,
      fromMe: z.boolean(),
      occurredAt: milliseconds,
      history: z.boolean(),
      messageType: z.enum([
        'text',
        'image',
        'audio',
        'video',
        'document',
        'sticker',
        'unsupported',
      ]),
      text: z.string().max(4096).optional(),
      contactName: z.string().min(1).max(100).optional(),
      media: z
        .object({
          id: z.string().regex(/^evo_[a-f0-9]{64}$/),
          mimeType: z
            .string()
            .min(1)
            .max(100)
            .regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i),
          filename: z.string().min(1).max(120).optional(),
          size: z.number().int().positive().max(3145728).optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('receipt'),
      ...verified,
      providerId,
      peer: phone,
      status: z.enum(['SENT', 'DELIVERED', 'READ', 'FAILED']),
      occurredAt: milliseconds,
    })
    .strict(),
]);
export const evolutionEventSchema = z
  .object({
    kind: z.literal('monzo.evolution.event'),
    id: z.string().regex(secretPattern),
    sequence: z.number().int().safe().positive(),
    scope: evolutionScopeSchema,
    payload: evolutionPayloadSchema,
  })
  .strict();
export type EvolutionEvent = z.infer<typeof evolutionEventSchema>;
