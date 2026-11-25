// MONZO change, 2026-11-25. Derived from Evolution API 2.3.8 (see LICENSE.upstream).
// The upstream '/' response makes an external WhatsApp version request. A health
// check must depend on this service rather than WAN latency. Remove only that
// optional field; actual Baileys version discovery and connections are unchanged.
import fs from 'node:fs';
const filename = '/evolution/dist/main.js';
const source = fs.readFileSync(filename, 'utf8');
const target = ',whatsappWebVersion:(await Qs({})).version.join(".")';
if (source.split(target).length !== 2)
  throw new Error('Unexpected Evolution build; review health patch.');
fs.writeFileSync(filename, source.replace(target, ''));
