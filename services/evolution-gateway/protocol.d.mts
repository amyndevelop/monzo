export const PROTOCOL: 'monzo-evolution-v1';
export const PROBE_PATH: '/api/integrations/evolution/probe';
export const EVENT_PATH: '/api/integrations/evolution/events';
export const secretPattern: RegExp;
export const noncePattern: RegExp;
export function sameSecret(a: unknown, b: unknown): boolean;
export function probeSignature(
  secret: string,
  body: Uint8Array | string,
  timestamp: string,
  nonce: string,
): string;
export function verifyProbe(
  secret: string,
  body: Uint8Array | string,
  headers: { timestamp: string | null; nonce: string | null; signature: string | null },
  now?: number,
): boolean;
export function responseProof(secret: string, challenge: string, nonce: string): string;
export function eventDigest(body: Uint8Array | string): string;
export function eventSignature(
  secret: string,
  body: Uint8Array | string,
  timestamp: string,
  nonce: string,
): string;
export function verifyEvent(
  secret: string,
  body: Uint8Array | string,
  headers: { timestamp: string | null; nonce: string | null; signature: string | null },
  now?: number,
): boolean;
export function eventProof(secret: string, id: string, digest: string, nonce: string): string;
