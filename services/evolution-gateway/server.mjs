import { createServer } from 'node:http';
import { diagnostics, checkEvolution, GatewayError } from './core.mjs';
import { PROTOCOL, sameSecret } from './protocol.mjs';
import { ChannelError } from './channel-engine.mjs';
import { StoreError } from './durable-store.mjs';
import { InstanceError } from './instance-client.mjs';

export function createGateway(config, transport = fetch, engine = null) {
  if (config.channelsEnabled && !engine) throw new GatewayError('CONFIG_CHANNEL_ENGINE', 503);
  let active = 0,
    counts = { diagnostics: 0, channels: 0, internal: 0 },
    windowStart = Date.now();
  const server = createServer(
    { maxHeaderSize: 8192, requestTimeout: 15000, headersTimeout: 10000 },
    async (req, res) => {
      const reply = (status, value) => {
        if (res.writableEnded || res.destroyed) return;
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(JSON.stringify(value));
      };
      if (req.url === '/healthz' && req.method === 'GET')
        return reply(200, { ok: true, protocol: PROTOCOL });
      const internal =
        config.channelsEnabled && req.url === '/internal/events' && req.method === 'POST';
      const channels =
        config.channelsEnabled &&
        req.method === 'POST' &&
        ['/v1/channels/command', '/v1/channels/state'].includes(req.url);
      if (
        !/^Bearer [a-f0-9]{64}$/.test(req.headers.authorization ?? '') ||
        (!internal && !sameSecret(req.headers.authorization?.slice(7), config.gatewayKey))
      ) {
        req.resume();
        return reply(401, { error: 'UNAUTHORIZED' });
      }
      if (!(
        (req.url === '/v1/status' && req.method === 'GET') ||
        (req.url === '/v1/diagnostics' && req.method === 'POST') ||
        internal ||
        channels
      )) {
        req.resume();
        return reply(404, { error: 'NOT_FOUND' });
      }
      if (Date.now() - windowStart >= 60000) {
        windowStart = Date.now();
        counts = { diagnostics: 0, channels: 0, internal: 0 };
      }
      const bucket = internal ? 'internal' : channels ? 'channels' : 'diagnostics';
      const limit = internal ? 1200 : channels ? 120 : 20;
      if (active >= (bucket === 'diagnostics' ? 2 : 8) || ++counts[bucket] > limit) {
        req.resume();
        return reply(429, { error: 'RATE_LIMIT' });
      }
      active++;
      try {
        if (req.method === 'GET')
          return reply(200, {
            protocol: PROTOCOL,
            evolution: await checkEvolution(config, transport),
          });
        if (!req.headers['content-type']?.startsWith('application/json'))
          throw new GatewayError('CONTENT_TYPE', 415);
        const length = req.headers['content-length'];
        const bodyLimit = internal ? 1048576 : 2048;
        if (length && (!/^\d+$/.test(length) || Number(length) > bodyLimit)) {
          req.resume();
          throw new GatewayError('BODY_LIMIT', 413);
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of req.iterator({ destroyOnReturn: false })) {
          size += chunk.length;
          if (size > bodyLimit) throw new GatewayError('BODY_LIMIT', 413);
          chunks.push(chunk);
        }
        let input;
        try {
          input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          throw new GatewayError('BAD_JSON', 400);
        }
        if (internal) return reply(200, engine.capture(input, req.headers.authorization));
        if (channels) {
          if (
            !input ||
            typeof input !== 'object' ||
            Array.isArray(input) ||
            input.callbackUrl !== config.callbackUrl
          )
            throw new GatewayError('CALLBACK_MISMATCH', 409);
          const { callbackUrl, ...command } = input;
          void callbackUrl;
          if (req.url === '/v1/channels/state' && Object.keys(command).join(',') !== 'scope')
            throw new GatewayError('BAD_REQUEST', 400);
          return reply(
            200,
            req.url === '/v1/channels/command'
              ? engine.command(command)
              : engine.status(command.scope),
          );
        }
        reply(200, await diagnostics(config, input, transport));
      } catch (error) {
        req.resume();
        const known =
          error instanceof GatewayError ||
          error instanceof ChannelError ||
          error instanceof StoreError ||
          error instanceof InstanceError;
        const status =
          error.status ??
          (error instanceof InstanceError
            ? 400
            : error.code === 'STORAGE_FULL'
              ? 507
              : ['STALE_GENERATION', 'NUMBER_SCOPE_CHANGED', 'IDEMPOTENCY_CONFLICT'].includes(
                    error.code,
                  )
                ? 409
                : 502);
        reply(known ? status : 502, {
          error: known ? error.code : 'SERVICE_UNAVAILABLE',
        });
      } finally {
        active--;
      }
    },
  );
  server.keepAliveTimeout = 5000;
  return server;
}
