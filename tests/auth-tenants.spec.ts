import {
  test as base,
  expect,
  request as requestFactory,
  type APIRequestContext,
} from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomBytes, createHash } from 'node:crypto';

const ORIGIN = 'http://127.0.0.1:3100';
const MAIL = 'http://127.0.0.1:8025';
const db = new PrismaClient();
const test = base.extend<{ ip: string }>({
  ip: async ({}, provide, testInfo) => {
    const hash = createHash('sha256')
      .update(testInfo.testId + randomBytes(8).toString('hex'))
      .digest();
    await provide(`10.${hash[0]}.${hash[1]}.${hash[2]}`);
  },
});
test.afterAll(async () => {
  await db.$disconnect();
});
function headers(ip: string) {
  return { origin: ORIGIN, 'x-forwarded-for': ip };
}
async function client(ip: string) {
  return requestFactory.newContext({ baseURL: ORIGIN, extraHTTPHeaders: headers(ip) });
}
async function messageURL(email: string, includes: string) {
  let url = '';
  await expect
    .poll(
      async () => {
        const response = await fetch(
          `${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
        );
        const inbox = await response.json();
        for (const message of inbox.messages ?? []) {
          const detail = await (await fetch(`${MAIL}/api/v1/message/${message.ID}`)).json();
          const urls: string[] = String(detail.Text).match(/https?:\/\/[^\s<>]+/g) ?? [];
          url = urls.find((value) => value.includes(includes)) ?? '';
          if (url) return true;
        }
        return false;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  expect(new URL(url).origin).toBe(ORIGIN);
  return url;
}
async function account(ip: string, verified = true) {
  const api = await client(ip);
  const email = `monzo-${randomBytes(8).toString('hex')}@example.test`;
  const password = `Monzo-${randomBytes(16).toString('hex')}`;
  const response = await api.post('/api/auth/sign-up/email', {
    data: { name: 'Persona de prueba', email, password, callbackURL: '/ingresar?verificado=1' },
  });
  expect(response.ok()).toBe(true);
  if (verified) {
    const verify = await api.get(await messageURL(email, '/api/auth/verify-email'));
    expect(verify.ok()).toBe(true);
    expect((await api.post('/api/auth/sign-in/email', { data: { email, password } })).ok()).toBe(
      true,
    );
  }
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  return { api, email, password, user };
}
async function create(api: APIRequestContext, name: string) {
  const response = await api.post('/api/workspaces', { data: { name } });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<{ id: string; name: string }>;
}
async function join(
  api: APIRequestContext,
  owner: APIRequestContext,
  tenantId: string,
  email: string,
  role = 'MEMBER',
  wrongAccount?: APIRequestContext,
) {
  expect(
    (await owner.post(`/api/workspaces/${tenantId}/invitations`, { data: { email, role } })).ok(),
  ).toBe(true);
  const url = await messageURL(email, '/invitacion?token=');
  const token = new URL(url).searchParams.get('token');
  if (wrongAccount)
    expect((await wrongAccount.post('/api/invitations/accept', { data: { token } })).status()).toBe(
      403,
    );
  expect((await api.post('/api/invitations/accept', { data: { token } })).ok()).toBe(true);
  return token;
}

test('sin sesión o con cookie inventada no se accede a empresas ni al dashboard', async ({
  page,
  ip,
}) => {
  const api = await client(ip);
  expect((await api.get('/api/workspaces')).status()).toBe(401);
  expect((await api.get('/api/workspaces/id-ajeno')).status()).toBe(401);
  await page.context().addCookies([
    { name: 'monzo.session_token', value: 'fabricada', domain: '127.0.0.1', path: '/' },
    { name: 'monzo.active-tenant', value: 'empresa-ajena', domain: '127.0.0.1', path: '/' },
  ]);
  await page.goto('/dashboard');
  await expect(page).toHaveURL('/ingresar');
  await expect(page.getByRole('heading', { level: 2 })).toContainText('Qué bueno verte');
  await api.dispose();
});

test('registro, verificación, login, empresa real y cierre de sesión desde la interfaz', async ({
  page,
  ip,
}, testInfo) => {
  await page.context().setExtraHTTPHeaders(headers(ip));
  const email = `ui-${randomBytes(8).toString('hex')}@example.test`;
  const password = `Monzo-${randomBytes(16).toString('hex')}`;
  await page.goto('/registro');
  await page.screenshot({ path: testInfo.outputPath('register.png'), fullPage: true });
  await page.getByLabel('Tu nombre').fill('Persona de prueba');
  await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: false }).fill(password);
  await page.getByRole('button', { name: 'Crear mi cuenta', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Revisá tu correo');
  await page.goto(await messageURL(email, '/api/auth/verify-email'));
  await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar a mi cuenta', exact: true }).click();
  await expect(page).toHaveURL('/empresas');
  await page.getByLabel('Nombre de la empresa').fill('Empresa UI de prueba');
  await page.getByRole('button', { name: 'Crear empresa', exact: true }).click();
  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Empresa UI de prueba.');
  await expect(page.getByText('Sesión verificada')).toBeVisible();
  await expect(page.locator('.demo-banner')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.name === 'monzo.session_token');
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Lax');
  await page.screenshot({ path: testInfo.outputPath('private-dashboard.png'), fullPage: true });
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Abrir navegación' }).click();
  await page
    .getByRole('navigation', { name: 'Navegación privada' })
    .getByRole('link', { name: 'Configuración', exact: true })
    .click();
  await page.getByLabel('Nombre de la empresa').fill('Empresa UI actualizada');
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Los cambios se guardaron');
  await page.screenshot({ path: testInfo.outputPath('settings.png'), fullPage: true });
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Abrir navegación' }).click();
  await page
    .getByRole('navigation', { name: 'Navegación privada' })
    .getByRole('link', { name: 'Equipo', exact: true })
    .click();
  await expect(page.getByRole('region', { name: 'Miembros de la empresa' })).toContainText(email);
  await page.screenshot({ path: testInfo.outputPath('team.png'), fullPage: true });
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page).toHaveURL('/ingresar');
  await page.goto('/dashboard');
  await expect(page).toHaveURL('/ingresar');
});

test('no se inicia sesión sin verificar correo ni con una contraseña incorrecta', async ({
  ip,
}) => {
  const user = await account(ip, false);
  expect(
    (
      await user.api.post('/api/auth/sign-in/email', {
        data: { email: user.email, password: user.password },
      })
    ).status(),
  ).toBe(403);
  expect((await user.api.get('/api/workspaces')).status()).toBe(401);
  expect(
    (
      await user.api.post('/api/auth/send-verification-email', {
        data: { email: user.email, callbackURL: '/ingresar?verificado=1' },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await user.api.post('/api/auth/send-verification-email', {
        data: {
          email: `unknown-${randomBytes(8).toString('hex')}@example.test`,
          callbackURL: '/ingresar?verificado=1',
        },
      })
    ).ok(),
  ).toBe(true);
  await user.api.get(await messageURL(user.email, '/api/auth/verify-email'));
  expect(
    (
      await user.api.post('/api/auth/sign-in/email', {
        data: { email: user.email, password: 'Contraseña incorrecta larga' },
      })
    ).status(),
  ).toBe(401);
  await user.api.dispose();
});

test('aislamiento: una cuenta no puede consultar, editar ni seleccionar la empresa de otra', async ({
  ip,
}) => {
  const a = await account(ip);
  const b = await account(ip);
  const tenantA = await create(a.api, 'Negocio A de prueba');
  const tenantB = await create(b.api, 'Negocio B de prueba');
  expect((await a.api.get(`/api/workspaces/${tenantB.id}`)).status()).toBe(403);
  expect((await a.api.get(`/api/workspaces/${tenantB.id}/members`)).status()).toBe(403);
  expect(
    (
      await a.api.patch(`/api/workspaces/${tenantB.id}`, {
        data: { name: 'Intrusión', timezone: 'UTC', locale: 'es' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await a.api.post('/api/workspaces/active', { data: { tenantId: tenantB.id } })).status(),
  ).toBe(403);
  const own = await (await a.api.get('/api/workspaces')).json();
  expect(own.memberships.map((m: { tenant: { id: string } }) => m.tenant.id)).toEqual([tenantA.id]);
  expect((await db.tenant.findUniqueOrThrow({ where: { id: tenantB.id } })).name).toBe(
    'Negocio B de prueba',
  );
  const guessed = await db.membership.findFirstOrThrow({ where: { tenantId: tenantB.id } });
  expect(
    (
      await a.api.delete(`/api/workspaces/${tenantB.id}/members/${guessed.id}`, { data: {} })
    ).status(),
  ).toBe(403);
  await a.api.dispose();
  await b.api.dispose();
});

test('invitaciones de un solo uso, roles, revocación y protección del último propietario', async ({
  ip,
}) => {
  const owner = await account(ip);
  const member = await account(ip);
  const outsider = await account(ip);
  const tenant = await create(owner.api, 'Equipo de prueba');
  const token = await join(member.api, owner.api, tenant.id, member.email, 'MEMBER', outsider.api);
  expect((await member.api.post('/api/invitations/accept', { data: { token } })).status()).toBe(
    403,
  );
  expect((await outsider.api.post('/api/invitations/accept', { data: { token } })).status()).toBe(
    403,
  );
  const members = await (await owner.api.get(`/api/workspaces/${tenant.id}/members`)).json();
  const ownMembership = members.find((m: { user: { id: string } }) => m.user.id === owner.user.id);
  const target = members.find((m: { user: { id: string } }) => m.user.id === member.user.id);
  expect(
    (
      await member.api.patch(`/api/workspaces/${tenant.id}`, {
        data: { name: 'Cambio prohibido', timezone: 'UTC', locale: 'es' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await member.api.patch(`/api/workspaces/${tenant.id}/members/${target.id}`, {
        data: { role: 'OWNER' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await owner.api.delete(`/api/workspaces/${tenant.id}/members/${ownMembership.id}`, {
        data: {},
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await owner.api.patch(`/api/workspaces/${tenant.id}/members/${target.id}`, {
        data: { role: 'ADMIN' },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await member.api.patch(`/api/workspaces/${tenant.id}`, {
        data: { name: 'Equipo actualizado', timezone: 'UTC', locale: 'en' },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await member.api.post(`/api/workspaces/${tenant.id}/invitations`, {
        data: { email: outsider.email, role: 'OWNER' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await owner.api.delete(`/api/workspaces/${tenant.id}/members/${target.id}`, { data: {} })
    ).ok(),
  ).toBe(true);
  expect((await member.api.get(`/api/workspaces/${tenant.id}`)).status()).toBe(403);
  expect(
    (await member.api.post('/api/workspaces/active', { data: { tenantId: tenant.id } })).status(),
  ).toBe(403);
  await owner.api.dispose();
  await member.api.dispose();
  await outsider.api.dispose();
});

test('recuperación: el enlace se usa una vez y revoca las sesiones anteriores', async ({ ip }) => {
  const user = await account(ip);
  const otherSession = await client(ip);
  expect(
    (
      await otherSession.post('/api/auth/sign-in/email', {
        data: { email: user.email, password: user.password },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await user.api.post('/api/auth/request-password-reset', {
        data: { email: user.email, redirectTo: '/restablecer' },
      })
    ).ok(),
  ).toBe(true);
  const link = await messageURL(user.email, '/api/auth/reset-password/');
  const redirected = await user.api.get(link);
  const token = new URL(redirected.url()).searchParams.get('token');
  expect(token).toBeTruthy();
  const newPassword = `Nueva-${randomBytes(16).toString('hex')}`;
  expect(
    (await user.api.post('/api/auth/reset-password', { data: { token, newPassword } })).ok(),
  ).toBe(true);
  expect((await otherSession.get('/api/workspaces')).status()).toBe(401);
  expect(
    (await user.api.post('/api/auth/reset-password', { data: { token, newPassword } })).ok(),
  ).toBe(false);
  expect(
    (
      await user.api.post('/api/auth/sign-in/email', {
        data: { email: user.email, password: user.password },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await user.api.post('/api/auth/sign-in/email', {
        data: { email: user.email, password: newPassword },
      })
    ).ok(),
  ).toBe(true);
  await user.api.dispose();
  await otherSession.dispose();
});

test('origen ajeno, validaciones y límite de intentos de inicio de sesión', async ({ ip }) => {
  const user = await account(ip);
  expect(
    (
      await user.api.post('/api/workspaces', {
        headers: { origin: 'https://sitio-ajeno.test' },
        data: { name: 'Empresa falsa' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await user.api.post('/api/workspaces', { data: { name: 'No permitido', role: 'OWNER' } })
    ).status(),
  ).toBe(400);
  expect(
    (
      await user.api.post('/api/auth/sign-in/email', {
        headers: { origin: 'https://sitio-ajeno.test' },
        data: { email: user.email, password: user.password },
      })
    ).status(),
  ).toBe(403);
  let status = 0;
  for (let i = 0; i < 9; i++)
    status = (
      await user.api.post('/api/auth/sign-in/email', {
        data: { email: user.email, password: 'Intento incorrecto de prueba' },
      })
    ).status();
  expect(status).toBe(429);
  await user.api.dispose();
});

test('el selector cambia entre empresas propias sin permitir IDs de membresía cruzados', async ({
  ip,
  page,
}, testInfo) => {
  const user = await account(ip);
  const first = await create(user.api, 'Empresa primera');
  const second = await create(user.api, 'Empresa segunda');
  const membership = await db.membership.findFirstOrThrow({
    where: { tenantId: second.id, userId: user.user.id },
  });
  expect(
    (
      await user.api.patch(`/api/workspaces/${first.id}/members/${membership.id}`, {
        data: { role: 'MEMBER' },
      })
    ).status(),
  ).toBe(403);
  expect((await db.membership.findUniqueOrThrow({ where: { id: membership.id } })).role).toBe(
    'OWNER',
  );
  expect(
    (await user.api.post('/api/workspaces/active', { data: { tenantId: first.id } })).ok(),
  ).toBe(true);
  await page.context().addCookies((await user.api.storageState()).cookies);
  await page.context().setExtraHTTPHeaders(headers(ip));
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Empresa primera.');
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Abrir navegación' }).click();
  await page.getByLabel('Empresa activa', { exact: true }).selectOption(second.id);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Empresa segunda.');
  await user.api.dispose();
});

test('cambios simultáneos no pueden dejar una empresa sin propietario', async ({ ip }) => {
  const a = await account(ip);
  const b = await account(ip);
  const tenant = await create(a.api, 'Propietarios concurrentes');
  await join(b.api, a.api, tenant.id, b.email);
  const memberB = await db.membership.findUniqueOrThrow({
    where: { tenantId_userId: { tenantId: tenant.id, userId: b.user.id } },
  });
  const memberA = await db.membership.findUniqueOrThrow({
    where: { tenantId_userId: { tenantId: tenant.id, userId: a.user.id } },
  });
  expect(
    (
      await a.api.patch(`/api/workspaces/${tenant.id}/members/${memberB.id}`, {
        data: { role: 'OWNER' },
      })
    ).ok(),
  ).toBe(true);
  const results = await Promise.all([
    a.api.patch(`/api/workspaces/${tenant.id}/members/${memberA.id}`, { data: { role: 'MEMBER' } }),
    b.api.patch(`/api/workspaces/${tenant.id}/members/${memberB.id}`, { data: { role: 'MEMBER' } }),
  ]);
  expect(results.map((response) => response.status()).sort()).toEqual([200, 409]);
  expect(await db.membership.count({ where: { tenantId: tenant.id, role: 'OWNER' } })).toBe(1);
  await a.api.dispose();
  await b.api.dispose();
});

test('una invitación vencida o un rol de invitación no permitido se rechazan', async ({ ip }) => {
  const owner = await account(ip);
  const target = await account(ip);
  const tenant = await create(owner.api, 'Invitación vencida');
  expect(
    (
      await owner.api.post(`/api/workspaces/${tenant.id}/invitations`, {
        data: { email: target.email, role: 'OWNER' },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await owner.api.post(`/api/workspaces/${tenant.id}/invitations`, {
        data: { email: target.email, role: 'MEMBER' },
      })
    ).ok(),
  ).toBe(true);
  const url = await messageURL(target.email, '/invitacion?token=');
  const token = new URL(url).searchParams.get('token');
  await db.tenantInvitation.update({
    where: { tenantId_email: { tenantId: tenant.id, email: target.email } },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  expect((await target.api.post('/api/invitations/accept', { data: { token } })).status()).toBe(
    403,
  );
  expect(
    await db.membership.count({ where: { tenantId: tenant.id, userId: target.user.id } }),
  ).toBe(0);
  await owner.api.dispose();
  await target.api.dispose();
});

test('las sesiones vencidas se rechazan sin confiar en la cookie', async ({ ip }) => {
  const user = await account(ip);
  await db.session.updateMany({
    where: { userId: user.user.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  expect((await user.api.get('/api/workspaces')).status()).toBe(401);
  await user.api.dispose();
});
