import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { evolutionProbe } from '../src/modules/evolution/probe.ts';
import { probeSignature, responseProof } from '../services/evolution-gateway/protocol.mjs';

test('probe: diagnóstico de configuración acotado, sin valores ni huellas privadas', async () => {
  const key = randomBytes(32).toString('hex');
  for (const [value, reason] of [
    [undefined, 'MISSING'],
    ['', 'MISSING'],
    ['"' + key + '"', 'QUOTED'],
    ['“' + key + '”', 'QUOTED'],
    [key + '\n', 'WHITESPACE'],
    [' ' + key, 'WHITESPACE'],
    ['EVOLUTION_WEBHOOK_SECRET=' + key, 'ASSIGNMENT'],
    ['not-a-valid-secret', 'INVALID_FORMAT'],
    [key.toUpperCase(), 'INVALID_FORMAT'],
  ]) {
    const response = await evolutionProbe(
      new Request('https://example.test', { method: 'POST' }),
      value,
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = await response.json();
    assert.deepEqual(data, { error: 'NOT_CONFIGURED', reason });
    assert.equal(JSON.stringify(data).includes(key), false);
  }
});

test('probe: una configuración válida conserva autenticación, firma y respuesta HMAC', async () => {
  const secret = randomBytes(32).toString('hex');
  const challenge = randomBytes(32).toString('hex');
  const nonce = randomBytes(16).toString('hex');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ kind: 'monzo.evolution.probe', challenge });
  const signedRequest = () =>
    new Request('https://example.test', {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'x-monzo-timestamp': timestamp,
        'x-monzo-nonce': nonce,
        'x-monzo-signature': probeSignature(secret, body, timestamp, nonce),
      },
    });
  const response = await evolutionProbe(signedRequest(), secret);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    challenge,
    proof: responseProof(secret, challenge, nonce),
  });
  assert.equal(
    (await evolutionProbe(new Request('https://example.test', { method: 'POST' }), secret)).status,
    401,
  );
  assert.equal(
    (await evolutionProbe(signedRequest(), randomBytes(32).toString('hex'))).status,
    401,
  );
});
