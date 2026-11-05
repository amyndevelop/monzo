import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { encryptToken, decryptToken } from '../core/crypto';
export class WebError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const webCommand = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create'),
      name: z.string().trim().min(1).max(80),
      phone: z.string().regex(/^[1-9][0-9]{5,14}$/),
    })
    .strict(),
  z
    .object({
      action: z.enum(['connect', 'disconnect']),
      accountId: z.string().min(1).max(128),
      generation: z.number().int().positive(),
    })
    .strict(),
]);
export async function commandWeb(
  db: PrismaClient,
  tenantId: string,
  userId: string,
  input: unknown,
) {
  const data = webCommand.parse(input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    const actor = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    if (actor?.role !== 'OWNER')
      throw new WebError(403, 'Solo el propietario puede vincular WhatsApp por QR.');
    if (data.action === 'create') {
      if ((await tx.whatsappAccount.count({ where: { tenantId, provider: 'BAILEYS' } })) >= 3)
        throw new WebError(409, 'Podés preparar hasta tres conexiones QR por empresa.');
      const duplicate = await tx.whatsappWebSession.findFirst({
        where: { tenantId, expectedWaId: data.phone },
      });
      if (duplicate) throw new WebError(409, 'Este número ya tiene una conexión QR en la empresa.');
      const identity = '9' + BigInt('0x' + randomBytes(11).toString('hex')).toString();
      const account = await tx.whatsappAccount.create({
        data: {
          tenantId,
          provider: 'BAILEYS',
          phoneNumberId: identity,
          businessAccountId: identity,
          displayPhone: '+' + data.phone,
          displayName: data.name,
        },
      });
      await tx.whatsappWebSession.create({
        data: { accountId: account.id, tenantId, expectedWaId: data.phone },
      });
      return { accountId: account.id };
    }
    const session = await tx.whatsappWebSession.findFirst({
      where: { tenantId, accountId: data.accountId, account: { provider: 'BAILEYS' } },
    });
    if (!session) throw new WebError(403, 'No tenés acceso a esta conexión.');
    if (session.generation !== data.generation)
      throw new WebError(
        409,
        'La conexión cambió. Actualizá el estado antes de repetir la acción.',
      );
    if (
      data.action === 'connect' &&
      session.desiredState === 'CONNECTED' &&
      session.state === 'CONNECTED'
    )
      return { accountId: session.accountId };
    if (data.action === 'connect') {
      const heartbeat = await tx.workerHeartbeat.findUnique({ where: { id: 'whatsapp-qr' } });
      if (!heartbeat || heartbeat.seenAt.getTime() < Date.now() - 45000)
        throw new WebError(409, 'El servicio QR del VPS está apagado o todavía no está instalado.');
    }
    await tx.whatsappAccount.update({ where: { id: session.accountId }, data: { enabled: false } });
    await tx.whatsappWebSession.update({
      where: { accountId: session.accountId },
      data: {
        generation: { increment: 1 },
        desiredState: data.action === 'connect' ? 'CONNECTED' : 'DISCONNECTED',
        state: data.action === 'connect' ? 'CONNECTING' : 'DISCONNECTING',
        qrEncrypted: null,
        qrExpiresAt: null,
        lastErrorCode: null,
      },
    });
    if (data.action === 'disconnect')
      await tx.message.updateMany({
        where: { accountId: session.accountId, tenantId, direction: 'OUTBOUND', status: 'QUEUED' },
        data: { status: 'CANCELED', errorCode: 'ACCOUNT_DISABLED' },
      });
    return { accountId: session.accountId };
  });
}
export function sealSession(value: string, tenantId: string, accountId: string) {
  return encryptToken(value, tenantId, 'qr:' + accountId);
}
export function openSession(value: string, tenantId: string, accountId: string) {
  return decryptToken(value, tenantId, 'qr:' + accountId);
}
export async function acquireWebLease(db: PrismaClient, accountId: string, owner: string) {
  const now = new Date();
  const result = await db.whatsappWebSession.updateMany({
    where: {
      accountId,
      OR: [{ leaseOwner: owner }, { leaseUntil: null }, { leaseUntil: { lt: now } }],
    },
    data: { leaseOwner: owner, leaseUntil: new Date(now.getTime() + 20000) },
  });
  return result.count === 1;
}
