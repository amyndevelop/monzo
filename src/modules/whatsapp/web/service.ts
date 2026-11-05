import 'server-only';
import QRCode from 'qrcode';
import { getDb } from '@/lib/db';
import { requireTenantAccess } from '@/modules/access/policy';
import { idSchema, RequestError } from '@/modules/tenants/http';
import { commandWeb, openSession, WebError } from './core';
export async function webStatus(tenantId: string) {
  const { membership } = await requireTenantAccess(idSchema.parse(tenantId));
  const canManage = membership.role === 'OWNER';
  const [rows, heartbeat] = await Promise.all([
    getDb().whatsappWebSession.findMany({
      where: { tenantId, account: { provider: 'BAILEYS' } },
      select: {
        accountId: true,
        generation: true,
        state: true,
        desiredState: true,
        expectedWaId: true,
        connectedWaId: true,
        qrEncrypted: true,
        qrExpiresAt: true,
        leaseUntil: true,
        lastErrorCode: true,
        account: { select: { displayName: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    getDb().workerHeartbeat.findUnique({ where: { id: 'whatsapp-qr' } }),
  ]);
  const workerReady = Boolean(heartbeat && heartbeat.seenAt.getTime() > Date.now() - 45000);
  const sessions = await Promise.all(
    rows.map(async ({ qrEncrypted, leaseUntil, account, ...s }) => {
      let qr: string | null = null;
      const live = Boolean(workerReady && leaseUntil && leaseUntil.getTime() > Date.now());
      if (
        canManage &&
        live &&
        s.state === 'QR' &&
        qrEncrypted &&
        s.qrExpiresAt &&
        s.qrExpiresAt.getTime() > Date.now()
      ) {
        try {
          qr = await QRCode.toDataURL(openSession(qrEncrypted, tenantId, s.accountId), {
            width: 280,
            margin: 2,
          });
        } catch {
          /* Do not expose credential or QR decoding failures. */
        }
      }
      return {
        ...s,
        name: account.displayName,
        qr,
        state: live
          ? s.state
          : s.desiredState === 'CONNECTED'
            ? 'OFFLINE'
            : s.state === 'DISCONNECTING'
              ? 'DISCONNECTING'
              : 'DISCONNECTED',
      };
    }),
  );
  return { sessions, canManage, workerReady };
}
export async function webAction(tenantId: string, input: unknown) {
  const { user } = await requireTenantAccess(idSchema.parse(tenantId), ['OWNER']);
  try {
    return await commandWeb(getDb(), tenantId, user.id, input);
  } catch (e) {
    if (e instanceof WebError) throw new RequestError(e.status, e.message);
    throw e;
  }
}
