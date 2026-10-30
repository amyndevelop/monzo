import { fetch as httpFetch, EnvHttpProxyAgent } from 'undici';
const phoneId = /^\d{5,30}$/;
export class MetaError extends Error {
  diagnostic?: string;
  subcode?: number;
  constructor(
    public code: string,
    public uncertain = false,
    public authorizationStep?: 'phone_lookup' | 'subscription',
  ) {
    super('WhatsApp request failed.');
  }
}
export type MetaFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
let dispatcher: EnvHttpProxyAgent | undefined;
const network: MetaFetch = async (url, init) => {
  dispatcher ??= new EnvHttpProxyAgent();
  return httpFetch(url, { ...init, dispatcher, redirect: 'error' });
};
export async function graphRequest(
  path: string,
  token: string,
  method = 'GET',
  body?: unknown,
  transport: MetaFetch = network,
) {
  if (
    transport === network &&
    process.env.DATABASE_URL &&
    new URL(process.env.DATABASE_URL).pathname === '/monzo_test'
  )
    throw new MetaError('TEST_NETWORK_DISABLED');
  const version = process.env.WHATSAPP_GRAPH_VERSION ?? 'v25.0';
  if (!/^v(2[5-9]|[3-9]\d)\.0$/.test(version)) throw new MetaError('GRAPH_VERSION');
  const templatePath =
    /^\d{5,30}(?:\/message_templates)?\?fields=id,name,status,category,language,parameter_format,components(?:&limit=50(?:&after=[A-Za-z0-9%_.~-]{1,6144})?)?$/.test(
      path,
    );
  if (
    !/^\d{5,30}\/(messages|phone_numbers|subscribed_apps)(\?fields=id,display_phone_number,verified_name&limit=100)?$/.test(
      path,
    ) &&
    !templatePath &&
    !/^\d{5,30}\?fields=id$/.test(path) &&
    !/^\d{5,30}\/phone_numbers\?fields=id&limit=100$/.test(path)
  )
    throw new MetaError('GRAPH_PATH');
  try {
    const response = await transport(`https://graph.facebook.com/${version}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = (await response.json()) as {
      error?: { code?: number; error_subcode?: number };
      [key: string]: unknown;
    };
    if (!response.ok) {
      const failure = new MetaError(
        typeof data.error?.code === 'number'
          ? `META_${data.error.code}`
          : `HTTP_${response.status}`,
        response.status >= 500,
      );
      if (Number.isSafeInteger(data.error?.error_subcode) && data.error!.error_subcode! >= 0)
        failure.subcode = data.error!.error_subcode;
      throw failure;
    }
    return data;
  } catch (error) {
    if (error instanceof MetaError) throw error;
    throw new MetaError('NETWORK_UNKNOWN', method === 'POST');
  }
}

// Bounded read-only probes after a rejected lookup. Never infer token validity
// or asset ownership from an ambiguous Graph error; never return provider text.
async function diagnosePhoneLookup(
  wabaId: string,
  phoneNumberId: string,
  token: string,
  transport?: MetaFetch,
) {
  const probe = async (path: string) => {
    try {
      return { data: await graphRequest(path, token, 'GET', undefined, transport), code: 'OK' };
    } catch (error) {
      return { data: null, code: error instanceof MetaError ? error.code : 'NETWORK_UNKNOWN' };
    }
  };
  const minimal = await probe(`${wabaId}/phone_numbers?fields=id&limit=100`);
  if (minimal.code === 'OK') {
    const phones = minimal.data?.data;
    if (!Array.isArray(phones))
      return 'La consulta mínima respondió sin una lista válida de números. No se intentó suscribir la app.';
    return phones.some((phone: { id?: string }) => phone.id === phoneNumberId)
      ? 'La consulta mínima sí encontró el número en esa WABA. El rechazo está en la consulta con campos adicionales; no cambies los IDs ni regeneres el token por este resultado. No se intentó suscribir la app.'
      : 'La consulta mínima accedió a la lista, pero el Phone Number ID no aparece entre los primeros 100 números. Revisá que pertenezca a esa WABA. No se intentó suscribir la app.';
  }
  if (minimal.code === 'META_190')
    return 'Meta rechazó la credencial también en la consulta mínima (META_190). No se intentó suscribir la app.';
  const [waba, phone] = await Promise.all([
    probe(`${wabaId}?fields=id`),
    probe(`${phoneNumberId}?fields=id`),
  ]);
  const access = (code: string) => (code === 'OK' ? 'accesible' : `no accesible (${code})`);
  return `Comprobaciones de lectura: objeto del WABA ID ${access(waba.code)}; objeto del Phone Number ID ${access(phone.code)}; lista mínima de números rechazada (${minimal.code}). Leer un objeto por ID no confirma su tipo ni la relación entre ambos. Si un objeto no es accesible, Graph no permite distinguir solo con este error entre ID incorrecto y falta de acceso. Revisá en Meta la cuenta seleccionada y su asignación al usuario del sistema. No se intentó suscribir la app.`;
}

export async function verifyAndSubscribe(
  wabaId: string,
  phoneNumberId: string,
  token: string,
  transport?: MetaFetch,
) {
  if (!phoneId.test(wabaId) || !phoneId.test(phoneNumberId)) throw new MetaError('IDENTIFIER');
  const authorize = async (
    step: 'phone_lookup' | 'subscription',
    path: string,
    method = 'GET',
    body?: unknown,
  ) => {
    try {
      return await graphRequest(path, token, method, body, transport);
    } catch (error) {
      if (error instanceof MetaError) {
        error.authorizationStep = step;
        if (step === 'phone_lookup' && error.code === 'META_100')
          error.diagnostic = await diagnosePhoneLookup(wabaId, phoneNumberId, token, transport);
      }
      throw error;
    }
  };
  const data = await authorize(
    'phone_lookup',
    `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100`,
  );
  const phones = data.data as
    { id: string; display_phone_number?: string; verified_name?: string }[] | undefined;
  const phone = Array.isArray(phones)
    ? phones.find((item) => item.id === phoneNumberId)
    : undefined;
  if (!phone) throw new MetaError('PHONE_NOT_IN_WABA', false, 'phone_lookup');
  const subscribed = await authorize('subscription', `${wabaId}/subscribed_apps`, 'POST', {});
  if (subscribed.success !== true)
    throw new MetaError('SUBSCRIPTION_FAILED', false, 'subscription');
  return {
    displayPhone: String(phone.display_phone_number ?? phoneNumberId).slice(0, 60),
    displayName: String(phone.verified_name ?? 'WhatsApp Business').slice(0, 120),
  };
}
async function sendContent(
  phoneNumberId: string,
  token: string,
  to: string,
  content: Record<string, unknown>,
  callbackId: string,
  transport?: MetaFetch,
) {
  async function send(recipient: string) {
    const data = await graphRequest(
      `${phoneNumberId}/messages`,
      token,
      'POST',
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        ...content,
        biz_opaque_callback_data: callbackId,
      },
      transport,
    );
    const messages = data.messages as { id?: string }[] | undefined;
    const id = messages?.[0]?.id;
    if (typeof id !== 'string' || !id.length || id.length > 256)
      throw new MetaError('RESPONSE_UNKNOWN', true);
    return id;
  }
  try {
    return await send(to);
  } catch (error) {
    // The test-recipient allowlist can use 54 + national number while the
    // webhook uses the Argentine mobile WA ID 549 + national number. Try that
    // equivalent format once, only after an explicit recipient rejection.
    // Successful or uncertain requests must never be sent again.
    if (
      error instanceof MetaError &&
      error.code === 'META_131030' &&
      !error.uncertain &&
      /^549\d{10}$/.test(to)
    )
      return send('54' + to.slice(3));
    throw error;
  }
}

export async function sendText(
  phoneNumberId: string,
  token: string,
  to: string,
  text: string,
  callbackId: string,
  transport?: MetaFetch,
) {
  return sendContent(
    phoneNumberId,
    token,
    to,
    { type: 'text', text: { preview_url: false, body: text } },
    callbackId,
    transport,
  );
}
export async function sendMedia(
  phoneNumberId: string,
  token: string,
  to: string,
  media: { type: string; id: string; filename?: string | null; caption?: string | null },
  callbackId: string,
  transport?: MetaFetch,
) {
  if (!['image', 'audio', 'video', 'document'].includes(media.type) || !/^\d{5,30}$/.test(media.id))
    throw new MetaError('MEDIA_UNAVAILABLE');
  return sendContent(
    phoneNumberId,
    token,
    to,
    {
      type: media.type,
      [media.type]: {
        id: media.id,
        ...(media.type === 'document' && media.filename ? { filename: media.filename } : {}),
        ...(media.type !== 'audio' && media.caption ? { caption: media.caption } : {}),
      },
    },
    callbackId,
    transport,
  );
}

export async function sendTemplate(
  phoneNumberId: string,
  token: string,
  to: string,
  template: { name: string; language: string; components: Record<string, unknown>[] },
  callbackId: string,
  transport?: MetaFetch,
) {
  return sendContent(
    phoneNumberId,
    token,
    to,
    {
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        ...(template.components.length ? { components: template.components } : {}),
      },
    },
    callbackId,
    transport,
  );
}

export function authorizationFailure(error: MetaError) {
  const step =
    error.authorizationStep === 'subscription'
      ? 'al suscribir la app a los mensajes'
      : error.authorizationStep === 'phone_lookup'
        ? 'al consultar los números de la cuenta de WhatsApp Business'
        : 'al verificar el número';
  const reason =
    error.code === 'META_100'
      ? 'Meta rechazó la solicitud. Esto no demuestra que el token haya vencido: revisá los IDs, el acceso a esa cuenta y la configuración de la app.'
      : error.code === 'META_190'
        ? 'Meta rechazó la credencial presentada; puede haber vencido, sido revocada o no ser válida para esta solicitud.'
        : error.code === 'PHONE_NOT_IN_WABA'
          ? 'El número no aparece entre los primeros 100 números de esa cuenta. Revisá que ambos IDs correspondan a la misma cuenta.'
          : 'Revisá la app, los IDs y los permisos o reintentá si hubo un problema de red.';
  return `No pudimos completar la autorización ${step} (${error.code}${error.subcode === undefined ? '' : `, subcódigo ${error.subcode}`}). ${error.diagnostic ?? reason} La nueva credencial no se guardó; la conexión anterior conserva su estado.`;
}

export async function sendInteractive(
  phoneNumberId: string,
  token: string,
  to: string,
  interactive: Record<string, unknown>,
  callbackId: string,
  transport?: MetaFetch,
) {
  return sendContent(
    phoneNumberId,
    token,
    to,
    { type: 'interactive', interactive },
    callbackId,
    transport,
  );
}
