import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { EvolutionCommand } from './channel-api';
import { ChannelRpcError } from './channel-api';

export class ChannelActionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const channelActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create'),
      name: z.string().trim().min(1).max(80),
      phone: z
        .string()
        .trim()
        .regex(/^\+?[0-9 ()-]{6,30}$/)
        .transform((value) => value.replace(/[^0-9]/g, ''))
        .pipe(z.string().regex(/^[1-9][0-9]{5,14}$/)),
    })
    .strict(),
  z
    .object({
      action: z.enum(['connect', 'refresh', 'disconnect']),
      accountId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
      generation: z.number().int().min(1).max(2147483646),
      idempotencyKey: z.uuid(),
    })
    .strict(),
]);
export async function commandEvolutionChannel(
  db: PrismaClient,
  tenantId: string,
  userId: string,
  input: unknown,
  submit: (command: EvolutionCommand) => Promise<unknown>,
  now = Date.now(),
) {
  const data = channelActionSchema.parse(input);
  const prepared = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    const actor = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    if (actor?.role !== 'OWNER')
      throw new ChannelActionError(
        403,
        'Solo el propietario puede vincular o desconectar este WhatsApp.',
      );
    if (data.action === 'create') {
      const existing = await tx.evolutionSession.findFirst({
        where: { tenantId, expectedWaId: data.phone },
        include: { account: true },
      });
      if (existing) {
        if (existing.account.displayName !== data.name)
          throw new ChannelActionError(
            409,
            'Este número ya está preparado. Usá su conexión existente.',
          );
        return { accountId: existing.accountId, generation: existing.generation, request: null };
      }
      if ((await tx.evolutionSession.count({ where: { tenantId } })) >= 3)
        throw new ChannelActionError(
          409,
          'Podés preparar hasta tres conexiones de WhatsApp por empresa.',
        );
      const identity = '8' + BigInt('0x' + randomBytes(11).toString('hex')).toString();
      const account = await tx.whatsappAccount.create({
        data: {
          tenantId,
          provider: 'EVOLUTION',
          phoneNumberId: identity,
          businessAccountId: identity,
          displayPhone: '+' + data.phone,
          displayName: data.name,
        },
      });
      const session = await tx.evolutionSession.create({
        data: { accountId: account.id, tenantId, expectedWaId: data.phone },
      });
      return { accountId: account.id, generation: session.generation, request: null };
    }
    const session = await tx.evolutionSession.findFirst({
      where: { tenantId, accountId: data.accountId, account: { provider: 'EVOLUTION' } },
    });
    if (!session) throw new ChannelActionError(403, 'No tenés acceso a esta conexión.');
    const commandId = data.action + ':' + data.idempotencyKey;
    const repeated = session.commandId === commandId;
    if (
      (!repeated && session.generation !== data.generation) ||
      (repeated &&
        session.generation !== data.generation &&
        !(data.action === 'connect' && session.generation === data.generation + 1))
    )
      throw new ChannelActionError(
        409,
        'La conexión cambió. Actualizá su estado antes de repetir la acción.',
      );
    if (
      !repeated &&
      data.action === 'connect' &&
      session.state === 'CONNECTED' &&
      session.desiredState === 'CONNECTED' &&
      session.lastSeenAt &&
      session.lastSeenAt.getTime() > now - 45000
    )
      return { accountId: session.accountId, generation: session.generation, request: null };
    if (data.action === 'refresh' && session.desiredState !== 'CONNECTED')
      throw new ChannelActionError(409, 'Generá una conexión nueva para este número.');
    if (!repeated) {
      const minute = BigInt(Math.floor(now / 60000) * 60000),
        key = 'evolution-channel-actions:' + tenantId;
      const rate = await tx.rateLimit.findUnique({ where: { key } });
      if (rate?.lastRequest === minute && rate.count >= 6)
        throw new ChannelActionError(
          429,
          'Esperá un momento antes de volver a solicitar una conexión.',
        );
      await tx.rateLimit.upsert({
        where: { key },
        create: { id: key, key, count: 1, lastRequest: minute },
        update: { count: rate?.lastRequest === minute ? rate.count + 1 : 1, lastRequest: minute },
      });
    }
    if (data.action !== 'disconnect') {
      const lock = 'monzo-qr-phone:' + session.expectedWaId;
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${lock},0))`;
      const [native, other] = await Promise.all([
        tx.whatsappWebSession.findFirst({
          where: {
            expectedWaId: session.expectedWaId,
            OR: [{ desiredState: 'CONNECTED' }, { state: { not: 'DISCONNECTED' } }],
          },
          select: { accountId: true },
        }),
        tx.evolutionSession.findFirst({
          where: {
            expectedWaId: session.expectedWaId,
            accountId: { not: session.accountId },
            OR: [{ desiredState: 'CONNECTED' }, { state: { not: 'DISCONNECTED' } }],
          },
          select: { accountId: true },
        }),
      ]);
      if (native || other)
        throw new ChannelActionError(
          409,
          'Este número ya tiene otra conexión activa. Desconectala y esperá su confirmación.',
        );
    }
    const generation = repeated
      ? session.generation
      : data.action === 'connect'
        ? session.generation + 1
        : session.generation;
    if (!repeated) {
      await tx.evolutionSession.update({
        where: { accountId: session.accountId },
        data: {
          generation,
          desiredState: data.action === 'disconnect' ? 'DISCONNECTED' : 'CONNECTED',
          state: data.action === 'disconnect' ? 'DISCONNECTING' : 'CONNECTING',
          qrEncrypted: null,
          qrExpiresAt: null,
          connectedWaId: null,
          lastErrorCode: null,
          commandId,
          ...(generation !== session.generation ? { lastEventSequence: 0, lastSeenAt: null } : {}),
        },
      });
      await tx.whatsappAccount.update({
        where: { id: session.accountId },
        data: { enabled: false, lastErrorCode: null },
      });
      if (data.action === 'disconnect' || generation !== session.generation)
        await tx.message.updateMany({
          where: {
            tenantId,
            accountId: session.accountId,
            direction: 'OUTBOUND',
            status: 'QUEUED',
          },
          data: {
            status: 'CANCELED',
            errorCode:
              data.action === 'disconnect' ? 'EVOLUTION_DISCONNECTED' : 'EVOLUTION_RECONNECTED',
          },
        });
    }
    const request: EvolutionCommand = {
      scope: {
        tenantId,
        accountId: session.accountId,
        generation,
        expectedPhone: session.expectedWaId,
      },
      commandId,
      operation: data.action,
      deadline: now + 120000,
    };
    return { accountId: session.accountId, generation, request };
  });
  if (prepared.request) {
    try {
      await submit(prepared.request);
    } catch (error) {
      const code = error instanceof ChannelRpcError ? error.code : 'UNREACHABLE';
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
        const changed = await tx.evolutionSession.updateMany({
          where: {
            tenantId,
            accountId: prepared.accountId,
            generation: prepared.generation,
            commandId: prepared.request!.commandId,
            state: { in: ['CONNECTING', 'DISCONNECTING'] },
          },
          data: {
            state: 'ERROR',
            qrEncrypted: null,
            qrExpiresAt: null,
            lastErrorCode: 'EVOLUTION_' + code,
          },
        });
        if (changed.count)
          await tx.whatsappAccount.updateMany({
            where: { tenantId, id: prepared.accountId },
            data: { enabled: false, lastErrorCode: 'EVOLUTION_' + code },
          });
      });
      throw error;
    }
  }
  return { accountId: prepared.accountId, generation: prepared.generation, accepted: true };
}
