import { fetch as httpFetch, EnvHttpProxyAgent } from 'undici';
const phoneId = /^\d{5,30}$/;
export class MetaError extends Error {
  constructor(
    public code: string,
    public uncertain = false,
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
  if (
    !/^\d{5,30}\/(messages|phone_numbers|subscribed_apps)(\?fields=id,display_phone_number,verified_name&limit=100)?$/.test(
      path,
    )
  )
    throw new MetaError('GRAPH_PATH');
  try {
    const response = await transport(`https://graph.facebook.com/${version}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = (await response.json()) as { error?: { code?: number }; [key: string]: unknown };
    if (!response.ok)
      throw new MetaError(
        typeof data.error?.code === 'number'
          ? `META_${data.error.code}`
          : `HTTP_${response.status}`,
        response.status >= 500,
      );
    return data;
  } catch (error) {
    if (error instanceof MetaError) throw error;
    throw new MetaError('NETWORK_UNKNOWN', method === 'POST');
  }
}
export async function verifyAndSubscribe(
  wabaId: string,
  phoneNumberId: string,
  token: string,
  transport?: MetaFetch,
) {
  if (!phoneId.test(wabaId) || !phoneId.test(phoneNumberId)) throw new MetaError('IDENTIFIER');
  const data = await graphRequest(
    `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100`,
    token,
    'GET',
    undefined,
    transport,
  );
  const phones = data.data as
    { id: string; display_phone_number?: string; verified_name?: string }[] | undefined;
  const phone = Array.isArray(phones)
    ? phones.find((item) => item.id === phoneNumberId)
    : undefined;
  if (!phone) throw new MetaError('PHONE_NOT_IN_WABA');
  const subscribed = await graphRequest(`${wabaId}/subscribed_apps`, token, 'POST', {}, transport);
  if (subscribed.success !== true) throw new MetaError('SUBSCRIPTION_FAILED');
  return {
    displayPhone: String(phone.display_phone_number ?? phoneNumberId).slice(0, 60),
    displayName: String(phone.verified_name ?? 'WhatsApp Business').slice(0, 120),
  };
}
export async function sendText(
  phoneNumberId: string,
  token: string,
  to: string,
  text: string,
  callbackId: string,
  transport?: MetaFetch,
) {
  const data = await graphRequest(
    `${phoneNumberId}/messages`,
    token,
    'POST',
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: text },
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
