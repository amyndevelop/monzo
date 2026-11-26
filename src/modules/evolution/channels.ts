import 'server-only';
import QRCode from 'qrcode';
import { getDb } from '@/lib/db';
import { requireTenantAccess } from '@/modules/access/policy';
import { authConfig } from '@/modules/auth/config';
import { RequestError, idSchema } from '@/modules/tenants/http';
import { evolutionConfiguration } from './core';
import { evolutionCommand, ChannelRpcError } from './channel-api';
import { commandEvolutionChannel, ChannelActionError } from './channel-commands';
import { decryptToken } from '../whatsapp/core/crypto';
import { qrContext } from './events';
import type { EvolutionChannelList } from './types';

export async function evolutionChannels(tenantId: string): Promise<EvolutionChannelList> {
  const { membership } = await requireTenantAccess(idSchema.parse(tenantId));
  const enabled = process.env.EVOLUTION_CHANNELS_ENABLED === 'true',
    config = evolutionConfiguration();
  const canManage = membership.role === 'OWNER',
    now = Date.now();
  if (!enabled)
    return {
      enabled: false,
      configured: config.configured,
      canManage,
      sessions: [],
      serverTime: now,
    };
  const rows = await getDb().evolutionSession.findMany({
    where: { tenantId, account: { provider: 'EVOLUTION' } },
    select: {
      accountId: true,
      generation: true,
      state: true,
      desiredState: true,
      expectedWaId: true,
      connectedWaId: true,
      qrEncrypted: true,
      qrExpiresAt: true,
      lastSeenAt: true,
      lastErrorCode: true,
      updatedAt: true,
      account: { select: { displayName: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  const sessions = await Promise.all(
    rows.map(async ({ account, qrEncrypted, updatedAt, lastSeenAt, ...session }) => {
      const fresh = Boolean(lastSeenAt && lastSeenAt.getTime() > now - 45000);
      const stale =
        session.desiredState === 'CONNECTED' &&
        !fresh &&
        (session.state === 'CONNECTED' ||
          session.state === 'QR' ||
          updatedAt.getTime() < now - 60000);
      const expired =
        session.lastErrorCode === 'QR_EXPIRED' ||
        (session.state === 'QR' && (!session.qrExpiresAt || session.qrExpiresAt.getTime() <= now));
      let qr: string | null = null,
        code = session.lastErrorCode;
      if (canManage && fresh && !expired && session.state === 'QR' && qrEncrypted) {
        try {
          qr = await QRCode.toDataURL(
            decryptToken(qrEncrypted, tenantId, qrContext(session.accountId, session.generation)),
            { width: 280, margin: 2 },
          );
        } catch {
          code = 'QR_UNAVAILABLE';
        }
      }
      return {
        ...session,
        name: account.displayName,
        qr,
        qrExpiresAt: session.qrExpiresAt?.toISOString() ?? null,
        lastSeenAt: lastSeenAt?.toISOString() ?? null,
        state: stale ? 'OFFLINE' : expired ? 'QR_EXPIRED' : session.state,
        lastErrorCode: code,
      };
    }),
  );
  await requireTenantAccess(tenantId, canManage ? ['OWNER'] : ['OWNER', 'ADMIN', 'MEMBER']);
  return {
    enabled: true,
    configured: config.configured,
    canManage,
    sessions,
    serverTime: Date.now(),
  };
}
export async function evolutionChannelAction(tenantId: string, input: unknown) {
  const { user } = await requireTenantAccess(idSchema.parse(tenantId), ['OWNER']);
  if (process.env.EVOLUTION_CHANNELS_ENABLED !== 'true')
    throw new RequestError(503, 'La vinculación por QR todavía se está preparando.');
  const config = evolutionConfiguration();
  if (!config.configured)
    throw new RequestError(
      503,
      'La conexión necesita una revisión del administrador antes de vincular un número.',
    );
  try {
    const result = await commandEvolutionChannel(getDb(), tenantId, user.id, input, (command) =>
      evolutionCommand(config, authConfig().origin, command),
    );
    await requireTenantAccess(tenantId, ['OWNER']);
    return result;
  } catch (error) {
    if (error instanceof ChannelActionError) throw new RequestError(error.status, error.message);
    if (error instanceof ChannelRpcError) {
      const messages: Record<string, string> = {
        PHONE_IN_USE:
          'Este número tiene otra conexión activa. Esperá a que se confirme su desconexión.',
        STALE_GENERATION: 'La conexión cambió. Actualizá su estado antes de repetir la acción.',
        IDEMPOTENCY_CONFLICT:
          'Esta solicitud ya fue utilizada. Actualizá el estado de la conexión.',
        COMMAND_EXPIRED: 'La solicitud venció. Volvé a generar la conexión.',
        BUSY: 'Hay varias solicitudes en curso. Esperá un momento para volver a intentar.',
        CHANNEL_CAPACITY:
          'Se alcanzó la capacidad de conexiones. El administrador debe revisar el servicio.',
        CALLBACK_MISMATCH:
          'El servicio está preparado para otro sitio. El administrador debe revisar la conexión.',
        CHANNELS_DISABLED: 'El servicio de vinculación todavía no está habilitado.',
        GATEWAY_AUTH: 'El administrador debe revisar la autorización de esta conexión.',
      };
      throw new RequestError(
        error.code === 'BUSY'
          ? 429
          : [
                'PHONE_IN_USE',
                'STALE_GENERATION',
                'IDEMPOTENCY_CONFLICT',
                'COMMAND_EXPIRED',
              ].includes(error.code)
            ? 409
            : 503,
        messages[error.code] ??
          (error.uncertain
            ? 'No pudimos confirmar la solicitud. Actualizá el estado antes de repetirla.'
            : 'No pudimos completar la solicitud. Intentá nuevamente en un momento.'),
      );
    }
    throw error;
  }
}
