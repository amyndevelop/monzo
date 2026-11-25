import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, lstatSync } from 'node:fs';
import { parseArgs, parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function prepareEvolution({ directory, domain, monzoOrigin, port = 18085 }) {
  if (
    !/^(?=.{1,253}$)(?!.*\.\.)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      domain,
    ) ||
    domain === 'localhost' ||
    /^\d+(\.\d+){3}$/.test(domain)
  )
    throw new Error('Use a public domain without scheme, path or credentials.');
  const origin = new URL(monzoOrigin);
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    origin.port ||
    ['localhost', '127.0.0.1'].includes(origin.hostname)
  )
    throw new Error('MONZO requires its exact public HTTPS origin.');
  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    [3000, 5432, 6379, 8000, 8001, 8080, 8081, 8082, 8083, 8085, 9222, 31460, 50002].includes(port)
  )
    throw new Error('Choose a dedicated loopback port.');
  const path = resolve(directory, '.env.evolution');
  const privateDirectory = resolve(directory, '.evolution');
  for (const candidate of [
    path,
    privateDirectory,
    resolve(privateDirectory, 'vercel.env'),
    resolve(privateDirectory, 'nginx-http.conf'),
    resolve(privateDirectory, 'nginx-https.conf'),
  ]) {
    try {
      if (lstatSync(candidate).isSymbolicLink())
        throw new Error('Private configuration paths must not be symbolic links.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const previous = existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
  if (
    (previous.EVOLUTION_PUBLIC_HOST && previous.EVOLUTION_PUBLIC_HOST !== domain) ||
    (previous.MONZO_ORIGIN && previous.MONZO_ORIGIN !== origin.origin) ||
    (previous.EVOLUTION_GATEWAY_PORT && previous.EVOLUTION_GATEWAY_PORT !== String(port))
  )
    throw new Error(
      'An existing configuration targets another host, environment or port. Review it instead of overwriting it.',
    );
  const config = {
    ...previous,
    EVOLUTION_PUBLIC_HOST: domain,
    MONZO_ORIGIN: origin.origin,
    EVOLUTION_GATEWAY_PORT: String(port),
  };
  for (const key of [
    'EVOLUTION_API_KEY',
    'EVOLUTION_GATEWAY_KEY',
    'EVOLUTION_WEBHOOK_SECRET',
    'EVOLUTION_DB_PASSWORD',
    'EVOLUTION_REDIS_PASSWORD',
  ]) {
    if (config[key] && !/^[a-f0-9]{64}$/.test(config[key]))
      throw new Error(
        'An existing credential has an unsupported format. Review the private configuration.',
      );
    config[key] ??= randomBytes(32).toString('hex');
  }
  if (
    new Set(
      [
        'EVOLUTION_API_KEY',
        'EVOLUTION_GATEWAY_KEY',
        'EVOLUTION_WEBHOOK_SECRET',
        'EVOLUTION_DB_PASSWORD',
        'EVOLUTION_REDIS_PASSWORD',
      ].map((key) => config[key]),
    ).size !== 5
  )
    throw new Error('Use independent credentials for each purpose.');
  mkdirSync(resolve(directory, '.evolution'), { recursive: true, mode: 0o700 });
  chmodSync(resolve(directory, '.evolution'), 0o700);
  writeFileSync(
    path,
    Object.entries(config)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join('\n') + '\n',
    { mode: 0o600 },
  );
  chmodSync(path, 0o600);
  const vercel = resolve(directory, '.evolution', 'vercel.env');
  writeFileSync(
    vercel,
    `EVOLUTION_GATEWAY_URL="https://${domain}"\nEVOLUTION_GATEWAY_KEY="${config.EVOLUTION_GATEWAY_KEY}"\nEVOLUTION_WEBHOOK_SECRET="${config.EVOLUTION_WEBHOOK_SECRET}"\n`,
    { mode: 0o600 },
  );
  chmodSync(vercel, 0o600);
  const common = `server_name ${domain};\n    client_max_body_size 2k;\n    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }\n`;
  const proxy = `location = /v1/diagnostics {\n        limit_except POST { deny all; }\n        proxy_pass http://127.0.0.1:${port};\n        proxy_connect_timeout 3s;\n        proxy_read_timeout 35s;\n        proxy_send_timeout 10s;\n        proxy_set_header Host $host;\n        proxy_set_header X-Forwarded-Proto https;\n        proxy_set_header Connection \"\";\n    }\n    location / { return 404; }`;
  const writeNginx = (filename, content, options) => {
    if (existsSync(filename) && readFileSync(filename, 'utf8') !== content)
      throw new Error(
        'An existing generated Nginx file differs. Preserve and review it before preparing another configuration.',
      );
    writeFileSync(filename, content, options);
    chmodSync(filename, 0o600);
  };
  writeNginx(
    resolve(directory, '.evolution', 'nginx-http.conf'),
    `server {\n    listen 80;\n    listen [::]:80;\n    ${common}    location / { return 404; }\n}\n`,
    { mode: 0o600 },
  );
  writeNginx(
    resolve(directory, '.evolution', 'nginx-https.conf'),
    `server {\n    listen 80;\n    listen [::]:80;\n    ${common}    location / { return 301 https://$host$request_uri; }\n}\nserver {\n    listen 443 ssl;\n    listen [::]:443 ssl;\n    server_name ${domain};\n    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;\n    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;\n    include /etc/letsencrypt/options-ssl-nginx.conf;\n    client_max_body_size 2k;\n    access_log off;\n    add_header X-Content-Type-Options nosniff always;\n    ${proxy}\n}\n`,
    { mode: 0o600 },
  );
  return { domain, origin: origin.origin, port };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        domain: { type: 'string' },
        'monzo-origin': { type: 'string' },
        port: { type: 'string' },
      },
    });
    if (!values.domain || !values['monzo-origin'])
      throw new Error(
        'Usage: node scripts/setup-evolution.mjs --domain DOMAIN --monzo-origin HTTPS_ORIGIN [--port 18085]',
      );
    prepareEvolution({
      directory: process.cwd(),
      domain: values.domain,
      monzoOrigin: values['monzo-origin'],
      port: values.port ? Number(values.port) : 18085,
    });
    console.log(
      'Private Evolution configuration and Nginx files prepared. No keys printed; no service started or system configuration changed.',
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Setup failed.');
    process.exitCode = 1;
  }
}
