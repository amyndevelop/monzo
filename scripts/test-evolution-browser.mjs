// Local browser integration harness. The WhatsApp provider is controlled; all
// application routes, signatures, PostgreSQL writes and UI interactions are real.
// Never run this on the VPS or with a production database.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { testEnvironment } from './test-env.mjs';
import { readConfig } from '../services/evolution-gateway/core.mjs';
import { DurableStore } from '../services/evolution-gateway/durable-store.mjs';
import { ChannelEngine } from '../services/evolution-gateway/channel-engine.mjs';
import { createGateway } from '../services/evolution-gateway/server.mjs';
import {
  instanceScope,
  instanceEventToken,
  InstanceError,
} from '../services/evolution-gateway/instance-client.mjs';
import { sameSecret } from '../services/evolution-gateway/protocol.mjs';

const key = () => randomBytes(32).toString('hex');
const { values: options } = parseArgs({
  options: { 'skip-build': { type: 'boolean' }, grep: { type: 'string' } },
  strict: true,
  allowPositionals: false,
});
const env = {
  ...testEnvironment(),
  EVOLUTION_CHANNELS_ENABLED: 'true',
  EVOLUTION_GATEWAY_KEY: key(),
  EVOLUTION_WEBHOOK_SECRET: key(),
  EVOLUTION_STORAGE_KEY: key(),
  NO_PROXY: '127.0.0.1,localhost',
  no_proxy: '127.0.0.1,localhost',
};
Object.assign(process.env, env);
const config = readConfig({
  ...env,
  NODE_ENV: 'test',
  MONZO_CALLBACK_URL: 'http://127.0.0.1:3100/api/integrations/evolution/probe',
  EVOLUTION_API_KEY: key(),
});
const db = new PrismaClient(),
  directory = mkdtempSync(join(tmpdir(), 'monzo-browser-evolution-'));
const store = new DurableStore({ directory, key: env.EVOLUTION_STORAGE_KEY }),
  states = new Map();
let engine,
  qrVersion = 0;
const client = {
  async status(scope) {
    const state = states.get(instanceScope(scope).name) ?? { state: 'NOT_CREATED' };
    if (state.state === 'CONNECTED' && state.connectedPhone !== scope.expectedPhone)
      throw new InstanceError('NUMBER_MISMATCH');
    return state;
  },
  async create(scope) {
    const name = instanceScope(scope).name;
    if (!states.has(name)) states.set(name, { state: 'DISCONNECTED' });
    return client.status(scope);
  },
  async connect(scope) {
    states.set(instanceScope(scope).name, { state: 'CONNECTING' });
    return { state: 'QR', qr: 'LOCAL_TEST_QR_' + ++qrVersion + '_' + instanceScope(scope).name };
  },
  async disconnect(scope) {
    states.set(instanceScope(scope).name, { state: 'DISCONNECTED' });
    return { state: 'DISCONNECTED' };
  },
  async sendText(scope, data) {
    const current = await client.status(scope);
    if (current.state !== 'CONNECTED') throw new InstanceError('CHANNEL_NOT_CONNECTED');
    capture(
      scope,
      {
        key: { id: data.providerId, fromMe: true, remoteJid: data.to + '@s.whatsapp.net' },
        message: { conversation: data.text },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
      'send.message',
    );
    return data.providerId;
  },
};
engine = new ChannelEngine(config, { store, client });
function capture(scope, data, event = 'messages.upsert') {
  return engine.capture(
    { instance: instanceScope(scope).name, event, date_time: new Date().toISOString(), data },
    'Bearer ' + instanceEventToken(config, scope),
  );
}
const gateway = createGateway({ ...config, channelsEnabled: true }, fetch, engine);
const controlKey = key();
const control = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.method !== 'POST' || !sameSecret(req.headers['x-test-key'], controlKey)) {
    res.writeHead(401);
    return res.end('{}');
  }
  try {
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 16384) throw new Error('LIMIT');
      chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const session = await db.evolutionSession.findUniqueOrThrow({
      where: { accountId: input.accountId },
    });
    const scope = {
      tenantId: session.tenantId,
      accountId: session.accountId,
      generation: session.generation,
      expectedPhone: session.expectedWaId,
    };
    if (req.url === '/scan') {
      states.set(instanceScope(scope).name, {
        state: 'CONNECTED',
        connectedPhone: input.wrongPhone ? '15550000000' : scope.expectedPhone,
      });
      await engine.poll();
    } else if (req.url === '/expire') {
      await db.evolutionSession.update({
        where: { accountId: session.accountId },
        data: { qrExpiresAt: new Date(Date.now() - 1000), lastErrorCode: 'QR_EXPIRED' },
      });
      const record = store.account(scope);
      store.updateAccount(scope, {
        ...record.data,
        qrIssuedAt: Date.now() - 46000,
        qrExpiresAt: Date.now() - 1000,
      });
    } else if (req.url === '/incoming') {
      capture(scope, {
        key: {
          id: input.providerId ?? 'LOCAL_' + randomBytes(12).toString('hex'),
          remoteJid: '15557654321@s.whatsapp.net',
          fromMe: input.fromMe === true,
        },
        message: { conversation: String(input.text ?? 'Consulta del fixture').slice(0, 4096) },
        messageTimestamp: Math.floor(Date.now() / 1000),
        pushName: input.fromMe ? 'Yo' : 'Cliente de pruebas',
      });
    } else if (req.url === '/read') {
      const message = await db.message.findFirstOrThrow({
        where: { accountId: session.accountId, direction: 'OUTBOUND', providerId: { not: null } },
        orderBy: { createdAt: 'desc' },
      });
      capture(
        scope,
        {
          keyId: message.providerId,
          remoteJid: '15557654321@s.whatsapp.net',
          fromMe: true,
          status: 'READ',
        },
        'messages.update',
      );
    } else {
      res.writeHead(404);
      return res.end('{}');
    }
    res.end('{"ok":true}');
  } catch {
    res.writeHead(400);
    res.end('{"error":"CONTROL_FIXTURE"}');
  }
});
await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
await new Promise((resolve) => control.listen(0, '127.0.0.1', resolve));
env.EVOLUTION_GATEWAY_URL = 'http://127.0.0.1:' + gateway.address().port;
env.EVO_TEST_CONTROL_URL = 'http://127.0.0.1:' + control.address().port;
env.EVO_TEST_CONTROL_KEY = controlKey;
const tasks = new Set(),
  timers = [];
for (const [work, ms] of [
  [() => engine.drainCommands(), 250],
  [() => engine.relay(), 250],
  [() => engine.poll(), 5000],
]) {
  let active = false;
  timers.push(
    setInterval(() => {
      if (active) return;
      active = true;
      const task = Promise.resolve()
        .then(work)
        .finally(() => {
          active = false;
          tasks.delete(task);
        });
      tasks.add(task);
      task.catch(() => {});
    }, ms),
  );
}
const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
let status = 1;
try {
  status = await run('npx', ['prisma', 'migrate', 'deploy']);
  if (status === 0 && !options['skip-build'])
    status = await run('npm', ['run', 'build', '--', '--webpack']);
  if (status === 0)
    status = await run('npx', [
      'playwright',
      'test',
      'tests/evolution-channels.spec.ts',
      '--workers=1',
      ...(options.grep ? ['--grep', options.grep] : []),
    ]);
} finally {
  for (const timer of timers) clearInterval(timer);
  gateway.closeAllConnections();
  control.closeAllConnections();
  await Promise.all([
    new Promise((resolve) => gateway.close(resolve)),
    new Promise((resolve) => control.close(resolve)),
    ...tasks,
  ]);
  store.close();
  rmSync(directory, { recursive: true, force: true });
  await db.$disconnect();
}
process.exit(status);
