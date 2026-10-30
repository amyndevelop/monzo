import { test, expect } from '@playwright/test';
import { sendText, type MetaFetch } from '../src/modules/whatsapp/core/meta';

const phoneId = '123456789012345';
const token = 'test-transport-only';
const waId = '5491112345678';
const callbackId = 'test-message-id';
const accepted = () => ({
  ok: true,
  status: 200,
  json: async () => ({ messages: [{ id: 'wamid.test' }] }),
});

test('Meta: un destino argentino aceptado conserva su WA ID y se envía una sola vez', async () => {
  const recipients: string[] = [];
  const transport: MetaFetch = async (_, init) => {
    recipients.push(JSON.parse(init.body!).to);
    return accepted();
  };
  expect(await sendText(phoneId, token, waId, 'Prueba', callbackId, transport)).toBe('wamid.test');
  expect(recipients).toEqual([waId]);
});

test('Meta: rechazo 131030 admite una única variante argentina sin cambiar mensaje ni correlación', async () => {
  const bodies: Record<string, unknown>[] = [];
  const transport: MetaFetch = async (_, init) => {
    const body = JSON.parse(init.body!);
    bodies.push(body);
    return body.to === waId
      ? { ok: false, status: 400, json: async () => ({ error: { code: 131030 } }) }
      : accepted();
  };
  expect(await sendText(phoneId, token, waId, 'Prueba', callbackId, transport)).toBe('wamid.test');
  expect(bodies.map((body) => body.to)).toEqual([waId, '541112345678']);
  expect(bodies[1]).toEqual({ ...bodies[0], to: '541112345678' });
  expect(bodies[1].biz_opaque_callback_data).toBe(callbackId);
});

test('Meta: otros países, números nacionales y longitudes inesperadas no cambian ante 131030', async () => {
  for (const to of ['5511123456789', '541112345678', '549111234567', '54911123456789']) {
    const recipients: string[] = [];
    const transport: MetaFetch = async (_, init) => {
      recipients.push(JSON.parse(init.body!).to);
      return { ok: false, status: 400, json: async () => ({ error: { code: 131030 } }) };
    };
    await expect(
      sendText(phoneId, token, to, 'Prueba', callbackId, transport),
    ).rejects.toMatchObject({
      code: 'META_131030',
      uncertain: false,
    });
    expect(recipients).toEqual([to]);
  }
});

test('Meta: credenciales, ventana, errores de servidor y resultados inciertos nunca prueban otro destino', async () => {
  const responses: { response: MetaFetch; code: string; uncertain: boolean }[] = [
    {
      response: async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: { code: 190 } }),
      }),
      code: 'META_190',
      uncertain: false,
    },
    {
      response: async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: { code: 131047 } }),
      }),
      code: 'META_131047',
      uncertain: false,
    },
    {
      response: async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: { code: 131030 } }),
      }),
      code: 'META_131030',
      uncertain: true,
    },
    {
      response: async () => {
        throw new Error('Connection interrupted');
      },
      code: 'NETWORK_UNKNOWN',
      uncertain: true,
    },
    {
      response: async () => ({ ok: true, status: 200, json: async () => ({}) }),
      code: 'RESPONSE_UNKNOWN',
      uncertain: true,
    },
  ];
  for (const { response, code, uncertain } of responses) {
    let calls = 0;
    const transport: MetaFetch = async (url, init) => {
      calls++;
      return response(url, init);
    };
    await expect(
      sendText(phoneId, token, waId, 'Prueba', callbackId, transport),
    ).rejects.toMatchObject({
      code,
      uncertain,
    });
    expect(calls).toBe(1);
  }
});

test('Meta: la variante rechazada o incierta no provoca un tercer envío', async () => {
  for (const networkFailure of [false, true]) {
    const recipients: string[] = [];
    const transport: MetaFetch = async (_, init) => {
      recipients.push(JSON.parse(init.body!).to);
      if (networkFailure && recipients.length === 2) throw new Error('Connection interrupted');
      return { ok: false, status: 400, json: async () => ({ error: { code: 131030 } }) };
    };
    await expect(
      sendText(phoneId, token, waId, 'Prueba', callbackId, transport),
    ).rejects.toMatchObject({
      code: networkFailure ? 'NETWORK_UNKNOWN' : 'META_131030',
      uncertain: networkFailure,
    });
    expect(recipients).toEqual([waId, '541112345678']);
  }
});

test('Meta: renovación distingue consulta y suscripción sin exponer la credencial', async () => {
  const { verifyAndSubscribe, authorizationFailure, MetaError } =
    await import('../src/modules/whatsapp/core/meta');
  for (const failSubscription of [false, true]) {
    const calls: string[] = [];
    const transport: MetaFetch = async (url) => {
      calls.push(url);
      return failSubscription && calls.length === 1
        ? { ok: true, status: 200, json: async () => ({ data: [{ id: phoneId }] }) }
        : { ok: false, status: 400, json: async () => ({ error: { code: 100, message: token } }) };
    };
    try {
      await verifyAndSubscribe('1171915459097699', phoneId, token, transport);
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(MetaError);
      const failure = error as InstanceType<typeof MetaError>;
      expect(failure.authorizationStep).toBe(failSubscription ? 'subscription' : 'phone_lookup');
      expect(authorizationFailure(failure)).toContain('META_100');
      expect(authorizationFailure(failure)).toContain('La nueva credencial no se guardó');
      expect(authorizationFailure(failure)).not.toContain(token);
      expect(calls).toHaveLength(failSubscription ? 2 : 1);
    }
  }
});

test('Meta: autorización completa comprueba pertenencia antes de suscribir', async () => {
  const { verifyAndSubscribe } = await import('../src/modules/whatsapp/core/meta');
  const calls: string[] = [];
  const transport: MetaFetch = async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () =>
        calls.length === 1
          ? { data: [{ id: phoneId, display_phone_number: '+54 11', verified_name: 'MONZO' }] }
          : { success: true },
    };
  };
  await expect(verifyAndSubscribe('1171915459097699', phoneId, token, transport)).resolves.toEqual({
    displayPhone: '+54 11',
    displayName: 'MONZO',
  });
  expect(calls[1]).toContain('/subscribed_apps');
});
