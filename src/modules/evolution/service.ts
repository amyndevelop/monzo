import 'server-only';
import { getDb } from '@/lib/db';
import { requireTenantAccess } from '@/modules/access/policy';
import { authConfig } from '@/modules/auth/config';
import { idSchema, RequestError } from '@/modules/tenants/http';
import { evolutionConfiguration, checkEvolutionGateway, EvolutionError } from './core';

export async function evolutionSettings(tenantId: string) {
  const { membership } = await requireTenantAccess(idSchema.parse(tenantId));
  const config = evolutionConfiguration();
  return {
    configured: config.configured,
    canCheck: membership.role === 'OWNER',
    configurationMessage: config.message,
  };
}
export async function evolutionDiagnostics(tenantId: string) {
  const { user } = await requireTenantAccess(idSchema.parse(tenantId), ['OWNER']);
  const config = evolutionConfiguration();
  if (!config.configured) throw new RequestError(409, config.message);
  await getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    const actor = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: user.id } },
    });
    if (actor?.role !== 'OWNER')
      throw new RequestError(403, 'Solo el propietario puede comprobar el servidor.');
    const key = `evolution-diagnostics:${tenantId}`;
    const minute = BigInt(Math.floor(Date.now() / 60000) * 60000);
    const previous = await tx.rateLimit.findUnique({ where: { key } });
    if (previous?.lastRequest === minute && previous.count >= 3)
      throw new RequestError(
        429,
        'Ya se hicieron tres comprobaciones en este minuto. Esperá un momento para volver a intentar.',
      );
    await tx.rateLimit.upsert({
      where: { key },
      create: { id: key, key, count: 1, lastRequest: minute },
      update: {
        count: previous?.lastRequest === minute ? previous.count + 1 : 1,
        lastRequest: minute,
      },
    });
  });
  try {
    const result = await checkEvolutionGateway(config, authConfig().origin);
    await requireTenantAccess(tenantId, ['OWNER']);
    return result;
  } catch (error) {
    if (error instanceof EvolutionError) {
      const messages: Record<string, string> = {
        UNREACHABLE:
          'No pudimos conectar con el servidor. Revisá HTTPS, Nginx y el servicio del VPS.',
        GATEWAY_AUTH:
          'El servidor rechazó la credencial de MONZO. Revisá la clave de conexión de ambos servicios.',
        CALLBACK_MISMATCH:
          'El servidor está preparado para otro sitio de MONZO. Revisá el destino de retorno; pruebas y producción deben usar configuraciones separadas.',
        BUSY: 'El servidor está ocupado con otras comprobaciones. Intentá nuevamente en un momento.',
        INVALID_RESPONSE:
          'El servidor devolvió una respuesta incompatible. Revisá la versión y la hora del VPS.',
      };
      throw new RequestError(
        502,
        messages[error.code] ?? 'No pudimos completar la comprobación del servidor.',
      );
    }
    throw error;
  }
}
