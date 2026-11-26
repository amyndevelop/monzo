import { createHash } from 'node:crypto';
import { instanceScope, InstanceError } from './instance-client.mjs';

const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const messageId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value);
const pn = (value) =>
  typeof value === 'string'
    ? /^([1-9][0-9]{5,14})(?::[0-9]{1,4})?@s\.whatsapp\.net$/.exec(value)?.[1]
    : null;
function peerFor(key) {
  const primary = pn(key?.remoteJid);
  if (primary) return primary;
  // A LID is not a phone number. Only the explicit PN alternate can resolve it.
  if (typeof key?.remoteJid === 'string' && /^[0-9]+(?::[0-9]{1,4})?@lid$/.test(key.remoteJid))
    return pn(key.remoteJidAlt);
  return null;
}
function seconds(value) {
  if (typeof value === 'string' && /^[0-9]{1,12}$/.test(value)) value = Number(value);
  if (
    object(value) &&
    Number.isInteger(value.low) &&
    Number.isInteger(value.high) &&
    value.high >= 0
  )
    value = (value.low >>> 0) + value.high * 4294967296;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 8640000000000) return null;
  const date = value * 1000;
  return Number.isSafeInteger(date) ? date : null;
}
function cleanName(value, maximum) {
  return typeof value === 'string'
    ? value
        .replace(/[\p{Cc}]/gu, '')
        .trim()
        .slice(0, maximum)
    : '';
}
function text(value) {
  return typeof value === 'string' ? value.slice(0, 4096) : undefined;
}

// This is a sanitizer, not an authorization check. The HTTP receiver must first
// verify the per-instance event credential. Candidates contain neither API keys,
// provider URLs nor raw message objects. Identity is attested separately before
// a candidate can become a signed MONZO event.
export function providerCandidates(raw, input, now = Date.now()) {
  const scope = instanceScope(input);
  if (!object(raw) || raw.instance !== scope.name || typeof raw.event !== 'string')
    throw new InstanceError('INSTANCE_EVENT_SCOPE');
  if (!object(raw.data) || (raw.data.instance !== undefined && raw.data.instance !== scope.name))
    return [];
  const observed = typeof raw.date_time === 'string' ? Date.parse(raw.date_time) : now;
  const observedAt =
    Number.isFinite(observed) && observed > 0 && observed <= now + 60000 ? observed : now;
  const records = [];
  const add = (candidate, key) =>
    records.push({ key: key ?? 'provider:' + hash(JSON.stringify(candidate)), candidate });
  if (raw.event === 'qrcode.updated') {
    const qr = raw.data.qrcode;
    if (
      object(qr) &&
      (qr.instance === undefined || qr.instance === scope.name) &&
      typeof qr.code === 'string' &&
      qr.code.length > 0 &&
      qr.code.length <= 4096 &&
      !/[\p{Cc}]/u.test(qr.code)
    )
      add(
        {
          type: 'connection',
          state: 'QR',
          qr: qr.code,
          observedAt,
          qrExpiresAt: observedAt + 45000,
        },
        'qr:' + hash(qr.code),
      );
    else if (raw.data.statusCode)
      add({ type: 'connection', state: 'ERROR', code: 'QR_NOT_READY', observedAt });
    return records;
  }
  if (raw.event === 'connection.update') {
    const states = {
      open: 'CONNECTED',
      close: 'DISCONNECTED',
      connecting: 'CONNECTING',
      refused: 'ERROR',
    };
    const state = Object.hasOwn(states, raw.data.state) ? states[raw.data.state] : null;
    if (state)
      add({
        type: 'connection',
        state,
        observedAt,
        ...(state === 'ERROR' ? { code: 'INSTANCE_REJECTED' } : {}),
      });
    return records;
  }
  if (raw.event === 'messages.update') {
    const statuses = {
      SERVER_ACK: 'SENT',
      DELIVERY_ACK: 'DELIVERED',
      READ: 'READ',
      PLAYED: 'READ',
      ERROR: 'FAILED',
    };
    const status = Object.hasOwn(statuses, raw.data.status) ? statuses[raw.data.status] : null,
      peer = peerFor(raw.data);
    if (
      raw.data.fromMe === true &&
      messageId(raw.data.keyId) &&
      peer &&
      peer !== scope.expectedPhone &&
      status
    )
      add({ type: 'receipt', providerId: raw.data.keyId, peer, status, occurredAt: observedAt });
    return records;
  }
  if (!['messages.upsert', 'send.message'].includes(raw.event)) return records;
  const data = raw.data,
    key = data.key,
    peer = peerFor(key);
  const occurredAt = seconds(data.messageTimestamp);
  if (
    !object(key) ||
    !messageId(key.id) ||
    typeof key.fromMe !== 'boolean' ||
    !peer ||
    peer === scope.expectedPhone ||
    !occurredAt ||
    occurredAt > now + 60000 ||
    !object(data.message)
  )
    return records;
  let message = data.message;
  for (let i = 0; i < 3; i++) {
    if (message.viewOnceMessage || message.viewOnceMessageV2 || message.viewOnceMessageV2Extension)
      return records;
    const nested = message.ephemeralMessage?.message ?? message.documentWithCaptionMessage?.message;
    if (!object(nested)) break;
    message = nested;
  }
  if (
    message.protocolMessage ||
    message.reactionMessage ||
    message.senderKeyDistributionMessage ||
    message.pollUpdateMessage ||
    message.editedMessage ||
    message.deviceSentMessage
  )
    return records;
  const candidate = {
    type: 'message',
    providerId: key.id,
    peer,
    fromMe: key.fromMe,
    occurredAt,
    history: false,
    messageType: 'unsupported',
    ...(!key.fromMe && cleanName(data.pushName, 100)
      ? { contactName: cleanName(data.pushName, 100) }
      : {}),
  };
  const body = text(message.conversation ?? message.extendedTextMessage?.text);
  if (body !== undefined && body.length > 0) {
    candidate.messageType = 'text';
    candidate.text = body;
  } else {
    for (const kind of ['image', 'audio', 'video', 'document', 'sticker']) {
      const media = message[kind + 'Message'];
      if (!object(media)) continue;
      if (media.viewOnce === true) return records;
      candidate.messageType = kind;
      const caption = text(media.caption);
      if (caption) candidate.text = caption;
      // No fake downloadable attachment: only a bounded request for the later
      // media stage. Its URL, mediaKey, thumbnails and bytes are never retained.
      const mimeType =
        typeof media.mimetype === 'string' &&
        /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(media.mimetype) &&
        media.mimetype.length <= 100
          ? media.mimetype
          : null;
      let size = media.fileLength;
      if (
        object(size) &&
        Number.isInteger(size.low) &&
        Number.isInteger(size.high) &&
        size.high >= 0
      )
        size = (size.low >>> 0) + size.high * 4294967296;
      if (typeof size === 'string' && /^[0-9]{1,10}$/.test(size)) size = Number(size);
      if (
        mimeType &&
        (size === undefined || (Number.isSafeInteger(size) && size > 0 && size <= 3145728))
      ) {
        const filename = cleanName(media.fileName, 120).replace(/[\\/]/g, '_');
        candidate.attachment = {
          mimeType,
          ...(filename ? { filename } : {}),
          ...(size ? { size } : {}),
        };
      }
      break;
    }
  }
  add(candidate);
  return records;
}

export function attestCandidate(candidate, input, proof) {
  const scope = instanceScope(input);
  if (!object(candidate)) throw new InstanceError('INSTANCE_EVENT_INVALID');
  if (candidate.type === 'connection') {
    if (candidate.state !== 'CONNECTED') return candidate;
    if (proof?.state !== 'CONNECTED' || proof.connectedPhone !== scope.expectedPhone)
      throw new InstanceError('INSTANCE_IDENTITY_UNAVAILABLE');
    return {
      ...candidate,
      connectedPhone: proof.connectedPhone,
      observedAt: proof.verifiedAt ?? candidate.observedAt,
    };
  }
  if (
    !['message', 'receipt'].includes(candidate.type) ||
    proof?.state !== 'CONNECTED' ||
    proof.connectedPhone !== scope.expectedPhone ||
    !Number.isSafeInteger(proof.verifiedAt) ||
    proof.verifiedAt <= 0
  )
    throw new InstanceError('INSTANCE_IDENTITY_UNAVAILABLE');
  const payload = {
    ...candidate,
    verifiedPhone: proof.connectedPhone,
    verifiedAt: proof.verifiedAt,
  };
  delete payload.attachment;
  return payload;
}
