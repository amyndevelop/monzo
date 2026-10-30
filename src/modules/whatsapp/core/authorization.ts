import type { PrismaClient } from '@prisma/client';
import { decryptToken } from './crypto';
import { graphRequest, MetaError, type MetaFetch } from './meta';

// Only reads Meta. Does not subscribe apps, send messages or dispatch queued jobs.
export async function checkSavedAuthorization(
  db: PrismaClient,
  tenantId: string,
  accountId: string,
  transport?: MetaFetch,
) {
  const account = await db.whatsappAccount.findFirst({ where: { id: accountId, tenantId } });
  if (!account)
    return {
      ok: false,
      code: 'ACCOUNT_UNAVAILABLE',
      message: 'El canal no está disponible para esta empresa.',
    };
  if (!account.tokenEncrypted)
    return {
      ok: false,
      code: 'CREDENTIAL_MISSING',
      message:
        'No hay una credencial guardada para comprobar. La desconexión elimina el token; completá una nueva autorización desde el formulario.',
    };
  let token: string;
  try {
    token = decryptToken(account.tokenEncrypted, tenantId, account.phoneNumberId);
  } catch {
    return {
      ok: false,
      code: 'CREDENTIAL_UNREADABLE',
      message:
        'MONZO no pudo descifrar la credencial guardada. El administrador debe revisar la clave de cifrado del despliegue; esto no es un rechazo de Meta.',
    };
  }
  let step = 'consulta del número';
  try {
    const phones = await graphRequest(
      `${account.businessAccountId}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100`,
      token,
      'GET',
      undefined,
      transport,
    );
    if (!Array.isArray(phones.data)) throw new MetaError('PHONE_RESPONSE');
    if (!phones.data.some((phone: { id?: string }) => phone.id === account.phoneNumberId))
      throw new MetaError('PHONE_NOT_IN_WABA');
    step = 'consulta de plantillas';
    const templates = await graphRequest(
      `${account.businessAccountId}/message_templates?fields=id,name,status,category,language,parameter_format,components&limit=50`,
      token,
      'GET',
      undefined,
      transport,
    );
    if (!Array.isArray(templates.data)) throw new MetaError('TEMPLATE_RESPONSE');
  } catch (error) {
    const code = error instanceof MetaError ? error.code : 'NETWORK_UNKNOWN';
    if (code === 'META_190')
      await db.whatsappAccount.updateMany({
        where: {
          id: accountId,
          tenantId,
          tokenEncrypted: account.tokenEncrypted,
          businessAccountId: account.businessAccountId,
        },
        data: { lastErrorCode: code },
      });
    const reason =
      code === 'META_190'
        ? 'Meta rechazó la credencial que MONZO tiene guardada. Generá otro token y completá la autorización.'
        : code === 'META_100'
          ? 'Meta rechazó la solicitud; esto no prueba que el token haya vencido. Revisá los IDs y el acceso a la cuenta en la app.'
          : code === 'PHONE_NOT_IN_WABA'
            ? 'El número no aparece en los primeros 100 números de esta cuenta. Revisá ambos IDs.'
            : 'No se pudo completar la comprobación. Revisá permisos y conexión o reintentá.';
    return {
      ok: false,
      code,
      message: `Falló la ${step} (${code}). ${reason} No se quitó el bloqueo del canal.`,
    };
  }
  // Prevent a concurrent disconnect, rotation or reconfiguration being overwritten.
  const changed = await db.whatsappAccount.updateMany({
    where: {
      id: accountId,
      tenantId,
      enabled: account.enabled,
      tokenEncrypted: account.tokenEncrypted,
      businessAccountId: account.businessAccountId,
      lastErrorCode: account.lastErrorCode,
    },
    data: { lastErrorCode: null, verifiedAt: new Date() },
  });
  if (!changed.count)
    return {
      ok: false,
      code: 'ACCOUNT_CHANGED',
      message: 'La conexión cambió durante la comprobación. Volvé a comprobarla.',
    };
  return {
    ok: true,
    code: account.enabled ? 'AUTHORIZED' : 'AUTHORIZED_DISCONNECTED',
    message: !account.enabled
      ? 'Meta aceptó la credencial guardada para consultar el número y las plantillas. El canal sigue desconectado: esta comprobación no lo reconecta ni envía mensajes. Completá la autorización del formulario para conectarlo.'
      : 'Meta aceptó la credencial guardada para consultar el número y las plantillas. Se quitó el bloqueo de autorización. No se enviaron mensajes ni se comprobó la entrega o la suscripción de webhooks.',
  };
}
