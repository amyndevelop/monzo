import { z } from 'zod';
export const templateDefinitionSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9_]{1,512}$/),
    language: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/),
    category: z.string().max(40),
    parameterFormat: z.enum(['POSITIONAL', 'NAMED']),
    header: z
      .object({
        format: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'NONE']),
        text: z.string().max(1024),
      })
      .strict(),
    body: z.string().max(4096),
    footer: z.string().max(1024),
    buttons: z
      .array(
        z
          .object({
            type: z.enum(['URL', 'PHONE_NUMBER', 'QUICK_REPLY']),
            text: z.string().max(128),
            url: z.string().max(2048).optional(),
            phoneNumber: z.string().max(30).optional(),
            parameterKey: z.string().max(150).optional(),
            index: z.number().int().min(0).max(9),
          })
          .strict(),
      )
      .max(10),
    parameters: z
      .array(
        z
          .object({
            key: z.string().max(150),
            name: z.string().max(64),
            component: z.enum(['header', 'body', 'button']),
            label: z.string().max(128),
            example: z.string().max(500),
            maxLength: z.number().int().min(1).max(500),
          })
          .strict(),
      )
      .max(40),
    unsupportedReason: z.string().max(300).nullable(),
  })
  .strict();
export const templateMediaSchema = z
  .object({
    id: z.string().regex(/^\d{5,30}$/),
    mime: z.string().max(150),
    filename: z.string().max(150),
    size: z
      .number()
      .int()
      .min(1)
      .max(3 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f\d]{64}$/),
    kind: z.enum(['image', 'video', 'document']),
  })
  .strict();
export const templateSnapshotSchema = z
  .object({
    version: z.literal(1),
    templateId: z.string().min(1).max(128),
    businessAccountId: z.string().regex(/^\d{5,30}$/),
    definitionHash: z.string().regex(/^[a-f\d]{64}$/),
    definition: templateDefinitionSchema,
    values: z.record(z.string().max(150), z.string().max(500)),
    inputHash: z.string().regex(/^[a-f\d]{64}$/),
    media: templateMediaSchema.nullable(),
  })
  .strict();
export type TemplateSnapshot = z.infer<typeof templateSnapshotSchema>;
export function readTemplateSnapshot(input: unknown) {
  const parsed = templateSnapshotSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
