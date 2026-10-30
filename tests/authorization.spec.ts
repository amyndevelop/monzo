import { test, expect } from '@playwright/test';
import type { PrismaClient } from '@prisma/client';
import { encryptToken } from '../src/modules/whatsapp/core/crypto';
import { checkSavedAuthorization } from '../src/modules/whatsapp/core/authorization';
import type { MetaFetch } from '../src/modules/whatsapp/core/meta';

test('comprobación guardada: solo GET, recuperación, rechazo, aislamiento y rotación', async () => {
  process.env.WHATSAPP_ENCRYPTION_KEY = 'ab'.repeat(32);
  for (const scenario of [
    'success',
    '190',
    '100',
    'network',
    'foreign',
    'rotated',
    'unreadable',
    'disabled',
    'wrong-phone',
    'template-190',
  ]) {
    const writes: unknown[] = [];
    const calls: { url: string; method: string }[] = [];
    const account = {
      id: 'account',
      tenantId: 'tenant',
      phoneNumberId: '1309498698924805',
      businessAccountId: '1171915459097699',
      enabled: scenario !== 'disabled',
      lastErrorCode: 'META_190',
      tokenEncrypted:
        scenario === 'unreadable'
          ? 'invalid'
          : encryptToken('private-test-token', 'tenant', '1309498698924805'),
    };
    const db = {
      whatsappAccount: {
        findFirst: async ({ where }: { where: { tenantId: string } }) => {
          expect(where.tenantId).toBe('tenant');
          return scenario === 'foreign' ? null : account;
        },
        updateMany: async (input: unknown) => {
          writes.push(input);
          return { count: scenario === 'rotated' ? 0 : 1 };
        },
      },
    } as unknown as PrismaClient;
    const transport: MetaFetch = async (url, init) => {
      calls.push({ url, method: init.method });
      expect(init.headers.Authorization).toBe('Bearer private-test-token');
      if (scenario === 'network') throw new Error('private-test-token');
      const rejected =
        scenario === '190' ||
        scenario === '100' ||
        (scenario === 'template-190' && calls.length === 2);
      return {
        ok: !rejected,
        status: rejected ? 400 : 200,
        json: async () =>
          rejected
            ? { error: { code: scenario === '100' ? 100 : 190, message: 'private-test-token' } }
            : {
                data:
                  calls.length === 1
                    ? [{ id: scenario === 'wrong-phone' ? '999999' : account.phoneNumberId }]
                    : [],
              },
      };
    };
    const result = await checkSavedAuthorization(db, 'tenant', 'account', transport);
    expect(result.ok).toBe(scenario === 'success');
    expect(JSON.stringify(result)).not.toContain('private-test-token');
    expect(calls.every((call) => call.method === 'GET' && !call.url.includes('/messages'))).toBe(
      true,
    );
    if (['foreign', 'unreadable', 'disabled'].includes(scenario)) expect(calls).toHaveLength(0);
    if (['190', 'template-190'].includes(scenario)) {
      expect(writes).toEqual([
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant',
            tokenEncrypted: account.tokenEncrypted,
          }),
          data: { lastErrorCode: 'META_190' },
        }),
      ]);
    } else if (['success', 'rotated'].includes(scenario)) {
      expect(writes).toEqual([
        expect.objectContaining({
          where: expect.objectContaining({
            enabled: true,
            tokenEncrypted: account.tokenEncrypted,
            lastErrorCode: 'META_190',
          }),
          data: expect.objectContaining({ lastErrorCode: null }),
        }),
      ]);
    } else expect(writes).toHaveLength(0);
  }
});
