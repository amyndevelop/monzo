import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { patchSendIds, sendIdFragments } from '../deploy/evolution/send-id-patch.mjs';

if (!process.argv[2])
  throw new Error('Pass the read-only bundle extracted from the pinned Evolution image.');
const source = readFileSync(process.argv[2], 'utf8');
const patched = patchSendIds(source);
assert.notEqual(patched, source);
assert.throws(() => patchSendIds(patched), /Unexpected Evolution build/);
for (const fragment of Object.values(sendIdFragments)) {
  assert.throws(() => patchSendIds(source.replace(fragment, '')), /Unexpected Evolution build/);
  assert.throws(() => patchSendIds(source + fragment), /Unexpected Evolution build/);
}
const textStart = patched.lastIndexOf('async textMessage(');
const textEnd = patched.indexOf('async pollMessage(', textStart);
const typingStart = patched.lastIndexOf('async sendMessageWithTyping(');
const typingEnd = patched.indexOf('async sendPresence(', typingStart);
assert.ok(textStart > 0 && textEnd > textStart && typingStart > 0 && typingEnd > typingStart);
const context = {
  y: Error,
  R: { isJidGroup: () => false },
  Mt: { default: { isLong: () => false } },
};
const methods = vm.runInNewContext(
  '({' + patched.slice(textStart, textEnd) + ',' + patched.slice(typingStart, typingEnd) + '})',
  context,
  { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } },
);
let calls = 0,
  captured;
const receiver = {
  sendMessageWithTyping: methods.sendMessageWithTyping,
  whatsappNumber: async () => {
    calls++;
    return [{ exists: true, jid: '15557654321@s.whatsapp.net' }];
  },
  logger: { verbose() {}, error() {} },
  sendMessage: async (...args) => {
    captured = args;
    return {
      key: { id: args[5] ?? 'PROVIDER_GENERATED', fromMe: true, remoteJid: args[0] },
      messageTimestamp: 1800000000,
      message: { conversation: args[1].conversation },
    };
  },
  prepareMessage: (message) => message,
  configService: {
    get: () => ({ ENABLED: false, ENABLE: false, SAVE_DATA: { NEW_MESSAGE: false } }),
  },
  localWebhook: { enabled: false },
  sendDataWebhook() {},
};
const id = '3EB0' + 'A'.repeat(18);
const result = await methods.textMessage.call(receiver, {
  number: '15557654321',
  text: 'Fixture',
  monzoMessageId: id,
  linkPreview: false,
});
assert.equal(captured[5], id);
assert.equal(result.key.id, id);
await methods.textMessage.call(receiver, { number: '15557654321', text: 'Default provider ID' });
assert.equal(captured[5], undefined);
for (const invalid of ['wrong', id.toLowerCase(), id + 'A', null, 123, { value: id }]) {
  const before = calls;
  await assert.rejects(
    () =>
      methods.textMessage.call(receiver, {
        number: '15557654321',
        text: 'Fixture',
        monzoMessageId: invalid,
      }),
    /Invalid MONZO message ID/,
  );
  assert.equal(calls, before);
}
// The pinned router copies all body fields into the DTO and the text schema
// does not prohibit extension fields. Verify both actual bundled contracts.
assert.ok(source.includes('Object.assign(n,r);let c=t?(0,Rt.validate)(n,t)'));
const schemaStart = source.indexOf('Qc={$id:') + 3;
const schemaEnd = source.indexOf(',zc={', schemaStart);
assert.ok(schemaStart > 3 && schemaEnd > schemaStart);
const schema = vm.runInNewContext(
  '(' + source.slice(schemaStart, schemaEnd) + ')',
  { de: { v4: () => 'fixture' }, Me: {}, je: {} },
  { timeout: 1000 },
);
assert.equal(schema.additionalProperties, undefined);
assert.equal(schema.properties.text.type, 'string');
console.log(
  'Bundle fijado comprobado: ID opcional llega al envío real de Baileys, ID por defecto preservado, formatos inválidos rechazados antes de consultar números, DTO/schema compatibles y deriva/reaplicación del parche rechazadas. Sin conexión a WhatsApp.',
);
