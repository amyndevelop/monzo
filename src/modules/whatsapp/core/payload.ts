import { z } from 'zod';
const id = z.string().min(1).max(256);
const timestamp = z.string().regex(/^\d{1,12}$/);
const media = z.object({ id: id.optional(), caption: z.string().max(4096).optional() });
export const valueSchema = z.object({
  metadata: z.object({ phone_number_id: z.string().regex(/^\d{5,30}$/) }),
  contacts: z
    .array(
      z.object({
        wa_id: z.string().regex(/^\d{5,20}$/),
        profile: z.object({ name: z.string().max(120) }).optional(),
      }),
    )
    .max(1000)
    .optional(),
  messages: z
    .array(
      z.object({
        id,
        from: z.string().regex(/^\d{5,20}$/),
        timestamp,
        type: z.string().max(30),
        text: z.object({ body: z.string().max(4096) }).optional(),
        image: media.optional(),
        audio: media.optional(),
        video: media.optional(),
        document: media.optional(),
        sticker: media.optional(),
      }),
    )
    .max(1000)
    .optional(),
  statuses: z
    .array(
      z.object({
        id,
        status: z.string().max(30),
        timestamp,
        biz_opaque_callback_data: z.string().max(128).optional(),
        errors: z
          .array(z.object({ code: z.number().int() }))
          .max(10)
          .optional(),
      }),
    )
    .max(1000)
    .optional(),
});
export const envelopeSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z
    .array(
      z.object({
        id: z.string().regex(/^\d{5,30}$/),
        changes: z.array(z.object({ field: z.string().max(100), value: z.unknown() })).max(100),
      }),
    )
    .max(100),
});
export type WebhookValue = z.infer<typeof valueSchema>;
export function providerDate(value: string, now = new Date()) {
  const date = new Date(Number(value) * 1000);
  if (!Number.isFinite(date.getTime()) || date.getTime() > now.getTime() + 120000)
    throw new Error('INVALID_PROVIDER_TIMESTAMP');
  return new Date(Math.min(date.getTime(), now.getTime()));
}
export function withinWindow(lastInboundAt: Date | null, now = new Date()) {
  return Boolean(lastInboundAt && lastInboundAt.getTime() > now.getTime() - 24 * 60 * 60 * 1000);
}
