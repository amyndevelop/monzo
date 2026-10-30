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
      expect(calls).toHaveLength(failSubscription ? 2 : 4);
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

test('Meta 100: diagnóstico acotado distingue campos, pertenencia y acceso sin suscribir ni filtrar texto', async () => {
  const { verifyAndSubscribe, authorizationFailure, MetaError } =
    await import('../src/modules/whatsapp/core/meta');
  const wabaId = '1171915459097699';
  for (const scenario of ['fields', 'missing', 'access', 'inaccessible', 'invalid', 'network']) {
    const calls: { url: string; method: string }[] = [];
    const transport: MetaFetch = async (url, init) => {
      calls.push({ url, method: init.method });
      if (scenario === 'network' && calls.length > 1) throw new Error(token);
      const minimal = url.includes('/phone_numbers?fields=id&');
      const object = url.endsWith('?fields=id');
      const ok =
        (minimal && ['fields', 'missing'].includes(scenario)) || (object && scenario === 'access');
      return {
        ok,
        status: ok ? 200 : 400,
        json: async () =>
          ok
            ? minimal
              ? { data: [{ id: scenario === 'missing' ? '9999999' : phoneId }] }
              : { id: url.includes(wabaId) ? wabaId : phoneId }
            : {
                error: {
                  code: minimal && scenario === 'invalid' ? 190 : 100,
                  error_subcode: 33,
                  message: token,
                  error_user_msg: token,
                },
              },
      };
    };
    try {
      await verifyAndSubscribe(wabaId, phoneId, token, transport);
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(MetaError);
      const failure = error as InstanceType<typeof MetaError>;
      const message = authorizationFailure(failure);
      expect(message).not.toContain(token);
      expect(message).toContain('subcódigo 33');
      expect(message).toContain('La nueva credencial no se guardó');
      expect(message).toContain('No se intentó suscribir');
      if (scenario === 'fields') expect(message).toContain('campos adicionales');
      if (scenario === 'missing') expect(message).toContain('no aparece');
      if (scenario === 'access') expect(message).toContain('no confirma su tipo');
      if (scenario === 'inaccessible') expect(message).toContain('ID incorrecto y falta de acceso');
      if (scenario === 'invalid') expect(message).toContain('META_190');
      expect(calls.length).toBeLessThanOrEqual(4);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    }
  }
});
