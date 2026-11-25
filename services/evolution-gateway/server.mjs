import { createServer } from 'node:http';
import { diagnostics, checkEvolution, GatewayError } from './core.mjs';
import { PROTOCOL, sameSecret } from './protocol.mjs';

export function createGateway(config, transport = fetch) {
  let active = 0,
    count = 0,
    windowStart = Date.now();
  const server = createServer(
    { maxHeaderSize: 8192, requestTimeout: 15000, headersTimeout: 10000 },
    async (req, res) => {
      const reply = (status, value) => {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(JSON.stringify(value));
      };
      if (req.url === '/healthz' && req.method === 'GET')
        return reply(200, { ok: true, protocol: PROTOCOL });
      if (
        !/^Bearer [a-f0-9]{64}$/.test(req.headers.authorization ?? '') ||
        !sameSecret(req.headers.authorization?.slice(7), config.gatewayKey)
      ) {
        req.resume();
        return reply(401, { error: 'UNAUTHORIZED' });
      }
      if (!(
        (req.url === '/v1/status' && req.method === 'GET') ||
        (req.url === '/v1/diagnostics' && req.method === 'POST')
      )) {
        req.resume();
        return reply(404, { error: 'NOT_FOUND' });
      }
      if (Date.now() - windowStart >= 60000) {
        windowStart = Date.now();
        count = 0;
      }
      if (active >= 2 || ++count > 20) {
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
        if (length && (!/^\d+$/.test(length) || Number(length) > 2048)) {
          req.resume();
          throw new GatewayError('BODY_LIMIT', 413);
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of req.iterator({ destroyOnReturn: false })) {
          size += chunk.length;
          if (size > 2048) throw new GatewayError('BODY_LIMIT', 413);
          chunks.push(chunk);
        }
        let input;
        try {
          input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          throw new GatewayError('BAD_JSON', 400);
        }
        reply(200, await diagnostics(config, input, transport));
      } catch (error) {
        req.resume();
        reply(error instanceof GatewayError ? error.status : 502, {
          error: error instanceof GatewayError ? error.code : 'SERVICE_UNAVAILABLE',
        });
      } finally {
        active--;
      }
    },
  );
  server.keepAliveTimeout = 5000;
  return server;
}
