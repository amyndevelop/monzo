import 'server-only';
function readConfig() {
  if (
    !['DATABASE_URL', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'SMTP_HOST', 'SMTP_FROM'].every(
      (key) => Boolean(process.env[key]),
    )
  )
    throw new Error('Authentication configuration is incomplete.');
  const secret = process.env.BETTER_AUTH_SECRET!;
  if (secret.length < 32)
    throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters.');
  const url = new URL(process.env.BETTER_AUTH_URL!);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (!['https:', 'http:'].includes(url.protocol) || (url.protocol !== 'https:' && !local))
    throw new Error('Authentication requires HTTPS outside local development.');
  if (process.env.VERCEL && local) throw new Error('Vercel requires the public HTTPS origin.');
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('BETTER_AUTH_URL must be an origin.');
  if (!local && (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD))
    throw new Error('Production SMTP credentials are required.');
  const port = Number(process.env.SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SMTP port.');
  return { secret, origin: url.origin, secureCookies: url.protocol === 'https:' };
}
export function isAuthConfigured(): boolean {
  try {
    readConfig();
    return true;
  } catch {
    return false;
  }
}
export function authConfig() {
  return readConfig();
}
