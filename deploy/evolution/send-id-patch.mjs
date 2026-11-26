// MONZO change, 2026-11-26. Evolution API 2.3.8; see LICENSE.upstream.
// Opt-in stable message IDs for the private gateway. Requests without the
// extension retain the provider's generated IDs. No retries are added.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const sendIdFragments = {
  text: 'async textMessage(e,t=!1){let o=e.text;if(!o||o.trim().length===0)throw new y("Text is required");return await this.sendMessageWithTyping(e.number,{conversation:e.text},{delay:e?.delay,presence:"composing",quoted:e?.quoted,linkPreview:e?.linkPreview,mentionsEveryOne:e?.mentionsEveryOne,mentioned:e?.mentioned},t)}',
  typing: 'async sendMessageWithTyping(e,t,o,i=!1){let n=(await this.whatsappNumber',
  group: 'this.sendMessage(r,t,u,a,c,null,f?.ephemeralDuration)',
  direct: 'this.sendMessage(r,t,u,a,c,null,void 0,m)',
};
export function patchSendIds(source) {
  if (typeof source !== 'string') throw new Error('Unexpected Evolution source.');
  for (const fragment of Object.values(sendIdFragments))
    if (source.split(fragment).length !== 2)
      throw new Error('Unexpected Evolution build; review stable message ID patch.');
  return source
    .replace(
      sendIdFragments.text,
      sendIdFragments.text.replace(
        'mentioned:e?.mentioned},t)',
        'mentioned:e?.mentioned,monzoMessageId:e.monzoMessageId},t)',
      ),
    )
    .replace(
      sendIdFragments.typing,
      'async sendMessageWithTyping(e,t,o,i=!1){if(o?.monzoMessageId!==void 0&&(typeof o.monzoMessageId!=="string"||!/^3EB0[A-F0-9]{18}$/.test(o.monzoMessageId)))throw new y("Invalid MONZO message ID");let n=(await this.whatsappNumber',
    )
    .replace(
      sendIdFragments.group,
      'this.sendMessage(r,t,u,a,c,o?.monzoMessageId,f?.ephemeralDuration)',
    )
    .replace(sendIdFragments.direct, 'this.sendMessage(r,t,u,a,c,o?.monzoMessageId,void 0,m)');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const file = '/evolution/dist/main.js';
  const patched = patchSendIds(readFileSync(file, 'utf8'));
  writeFileSync(file, patched);
}
