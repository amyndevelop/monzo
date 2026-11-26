import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instanceScope } from '../instance-client.mjs';
import { providerCandidates, attestCandidate } from '../provider-events.mjs';

const now = 1800000000000;
const scope = {
  tenantId: 'provider-tenant',
  accountId: 'provider-account',
  generation: 1,
  expectedPhone: '15551234567',
};
const name = instanceScope(scope).name;
const proof = { state: 'CONNECTED', connectedPhone: scope.expectedPhone, verifiedAt: now };
const fixture = (data, event = 'messages.upsert') => ({
  instance: name,
  event,
  date_time: new Date(now).toISOString(),
  apikey: 'never-store-api-key',
  server_url: 'https://private.example.invalid',
  data,
});
const message = (changes = {}) => ({
  key: { id: '3EB0TEST123', remoteJid: '15557654321@s.whatsapp.net', fromMe: false },
  message: { conversation: 'Hola' },
  messageTimestamp: Math.floor(now / 1000),
  pushName: 'Cliente',
  ...changes,
});

test('proveedor: conserva solo contenido normalizado y requiere identidad comprobada', () => {
  const raw = fixture(message());
  const [record] = providerCandidates(raw, scope, now);
  assert.equal(record.candidate.text, 'Hola');
  for (const privateValue of [raw.apikey, raw.server_url])
    assert.equal(JSON.stringify(record).includes(privateValue), false);
  assert.throws(() => attestCandidate(record.candidate, scope), /INSTANCE_IDENTITY_UNAVAILABLE/);
  assert.throws(
    () => attestCandidate(record.candidate, scope, { ...proof, connectedPhone: '15550000000' }),
    /INSTANCE_IDENTITY_UNAVAILABLE/,
  );
  assert.deepEqual(attestCandidate(record.candidate, scope, proof), {
    type: 'message',
    providerId: '3EB0TEST123',
    peer: '15557654321',
    fromMe: false,
    occurredAt: now,
    history: false,
    messageType: 'text',
    text: 'Hola',
    contactName: 'Cliente',
    verifiedPhone: scope.expectedPhone,
    verifiedAt: now,
  });
});

test('proveedor: LID requiere alternativo PN; ignora grupos, estados, canales y mensajes propios al mismo número', () => {
  const original = message();
  const lid = {
    ...original.key,
    remoteJid: '99999999@lid',
    remoteJidAlt: '15557654321@s.whatsapp.net',
  };
  assert.equal(
    providerCandidates(fixture(message({ key: lid })), scope, now)[0].candidate.peer,
    '15557654321',
  );
  for (const key of [
    { ...lid, remoteJidAlt: undefined },
    { ...lid, remoteJid: '120000000@g.us' },
    { ...lid, remoteJid: 'status@broadcast' },
    { ...lid, remoteJid: '123456@newsletter' },
    { ...original.key, remoteJid: scope.expectedPhone + '@s.whatsapp.net' },
  ])
    assert.deepEqual(providerCandidates(fixture(message({ key })), scope, now), []);
  assert.throws(
    () => providerCandidates({ ...fixture(original), instance: 'another-tenant' }, scope, now),
    /INSTANCE_EVENT_SCOPE/,
  );
});

test('proveedor: QR usa el primer instante del evento, ignora base64 y no acepta la identidad anunciada por el webhook', () => {
  const [record] = providerCandidates(
    fixture(
      {
        qrcode: {
          instance: name,
          code: 'private-qr-fixture',
          base64: 'never-store-base64',
          pairingCode: 'never-store-pairing',
        },
      },
      'qrcode.updated',
    ),
    scope,
    now,
  );
  assert.equal(record.candidate.qrExpiresAt, now + 45000);
  assert.equal(JSON.stringify(record).includes('never-store'), false);
  assert.equal(
    providerCandidates(
      fixture({ qrcode: { code: 'private-qr-fixture' } }, 'qrcode.updated'),
      scope,
      now + 10000,
    )[0].key,
    record.key,
  );
  const [open] = providerCandidates(
    fixture({ state: 'open', wuid: scope.expectedPhone + '@s.whatsapp.net' }, 'connection.update'),
    scope,
    now,
  );
  assert.throws(() => attestCandidate(open.candidate, scope), /INSTANCE_IDENTITY_UNAVAILABLE/);
  assert.equal(attestCandidate(open.candidate, scope, proof).connectedPhone, scope.expectedPhone);
  assert.deepEqual(
    providerCandidates(fixture({ qrcode: { code: 'invalid\nQR' } }, 'qrcode.updated'), scope, now),
    [],
  );
});

test('proveedor: recibos usan keyId, remitente y estados reales del contrato fijado', () => {
  for (const [status, expected] of [
    ['SERVER_ACK', 'SENT'],
    ['DELIVERY_ACK', 'DELIVERED'],
    ['READ', 'READ'],
    ['PLAYED', 'READ'],
    ['ERROR', 'FAILED'],
  ]) {
    const [record] = providerCandidates(
      fixture(
        {
          keyId: '3EB0TEST123',
          remoteJid: '15557654321@s.whatsapp.net',
          fromMe: true,
          status,
          messageId: 'private-upstream-row',
        },
        'messages.update',
      ),
      scope,
      now,
    );
    assert.equal(record.candidate.providerId, '3EB0TEST123');
    assert.equal(record.candidate.status, expected);
    assert.equal(JSON.stringify(record).includes('private-upstream-row'), false);
    assert.equal(
      attestCandidate(record.candidate, scope, proof).verifiedPhone,
      scope.expectedPhone,
    );
  }
  assert.deepEqual(
    providerCandidates(
      fixture(
        {
          keyId: '3EB0TEST123',
          remoteJid: '15557654321@s.whatsapp.net',
          fromMe: false,
          status: 'READ',
        },
        'messages.update',
      ),
      scope,
      now,
    ),
    [],
  );
});

test('proveedor: timestamps, límites, intervención humana y mensajes de control no disparan contenido falso', () => {
  const stamp = Math.floor(now / 1000);
  assert.equal(
    providerCandidates(
      fixture(
        message({
          messageTimestamp: { low: stamp, high: 0, unsigned: true },
          message: { extendedTextMessage: { text: 'x'.repeat(5000) } },
        }),
      ),
      scope,
      now,
    )[0].candidate.text.length,
    4096,
  );
  assert.deepEqual(
    providerCandidates(fixture(message({ messageTimestamp: stamp + 61 })), scope, now),
    [],
  );
  assert.deepEqual(
    providerCandidates(fixture(message({ messageTimestamp: { low: 1, high: -1 } })), scope, now),
    [],
  );
  for (const content of [
    { protocolMessage: {} },
    { reactionMessage: {} },
    { viewOnceMessage: { message: { imageMessage: {} } } },
    { imageMessage: { viewOnce: true } },
    { pollUpdateMessage: {} },
  ])
    assert.deepEqual(providerCandidates(fixture(message({ message: content })), scope, now), []);
  const own = message();
  own.key.fromMe = true;
  own.pushName = 'Yo';
  assert.equal(
    providerCandidates(fixture(own, 'send.message'), scope, now)[0].candidate.contactName,
    undefined,
  );
});

test('proveedor: adjuntos preparan metadatos acotados sin URL, mediaKey, miniaturas ni descargas ficticias', () => {
  const [record] = providerCandidates(
    fixture(
      message({
        message: {
          documentWithCaptionMessage: {
            message: {
              documentMessage: {
                caption: 'Comprobante',
                fileName: '../factura.pdf',
                mimetype: 'application/pdf',
                fileLength: { low: 120, high: 0 },
                url: 'https://private.example.invalid/media',
                mediaKey: 'never-store-media-key',
                jpegThumbnail: 'never-store-thumb',
              },
            },
          },
        },
      }),
    ),
    scope,
    now,
  );
  assert.equal(record.candidate.messageType, 'document');
  assert.deepEqual(record.candidate.attachment, {
    mimeType: 'application/pdf',
    filename: '.._factura.pdf',
    size: 120,
  });
  assert.equal(JSON.stringify(record).includes('never-store'), false);
  assert.equal(JSON.stringify(record).includes('https://'), false);
  const payload = attestCandidate(record.candidate, scope, proof);
  assert.equal(payload.attachment, undefined);
  assert.equal(payload.media, undefined);
  assert.equal(payload.text, 'Comprobante');
  const [large] = providerCandidates(
    fixture(message({ message: { audioMessage: { mimetype: 'audio/ogg', fileLength: 3145729 } } })),
    scope,
    now,
  );
  assert.equal(large.candidate.attachment, undefined);
});
