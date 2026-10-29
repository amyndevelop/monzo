import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
export function encryptionKey() {
  const value = process.env.WHATSAPP_ENCRYPTION_KEY ?? '';
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error('WHATSAPP_ENCRYPTION_KEY must be 32 random bytes encoded in hex.');
  return Buffer.from(value, 'hex');
}
export function encryptToken(value: string, tenantId: string, phoneNumberId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`${tenantId}:${phoneNumberId}`));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${data.toString('base64url')}`;
}
export function decryptToken(value: string, tenantId: string, phoneNumberId: string) {
  const [version, iv, tag, data, ...rest] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !data || rest.length)
    throw new Error('Invalid token envelope.');
  const cipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  cipher.setAAD(Buffer.from(`${tenantId}:${phoneNumberId}`));
  cipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([cipher.update(Buffer.from(data, 'base64url')), cipher.final()]).toString(
    'utf8',
  );
}
export function safeEqual(a: string, b: string) {
  const first = Buffer.from(a);
  const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}
export function validSignature(body: Buffer, signature: string | null) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  return safeEqual(expected, signature.toLowerCase());
}
export function whatsappConfigured() {
  try {
    encryptionKey();
    return Boolean(process.env.WHATSAPP_APP_SECRET && process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN);
  } catch {
    return false;
  }
}
