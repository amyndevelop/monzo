import 'server-only';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { z } from 'zod';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { getDb } from '@/lib/db';
import { authConfig } from './config';
import { sendAccountEmail } from './email';
let instance: ReturnType<typeof createAuth> | undefined;
function createAuth() {
  const config = authConfig();
  return betterAuth({
    appName: 'MONZO',
    baseURL: config.origin,
    secret: config.secret,
    trustedOrigins: [config.origin],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (['/sign-up/email', '/update-user'].includes(ctx.path) && ctx.body?.name !== undefined) {
          const parsed = z.string().trim().min(2).max(80).safeParse(ctx.body.name);
          if (!parsed.success)
            throw new APIError('BAD_REQUEST', {
              message: 'El nombre debe tener entre 2 y 80 caracteres.',
            });
          ctx.body.name = parsed.data;
        }
      }),
    },
    database: prismaAdapter(getDb(), { provider: 'postgresql', transaction: true }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) =>
        sendAccountEmail(
          user.email,
          'Restablecé tu contraseña de MONZO',
          `Recibimos una solicitud para restablecer tu contraseña.\n\n${url}\n\nSi no la pediste, ignorá este mensaje.`,
        ),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      sendVerificationEmail: async ({ user, url }) =>
        sendAccountEmail(
          user.email,
          'Verificá tu correo de MONZO',
          `Para activar tu cuenta de MONZO, confirmá tu correo:\n\n${url}\n\nEl enlace vence en una hora. Si no creaste la cuenta, ignorá este mensaje.`,
        ),
    },
    account: { accountLinking: { enabled: false } },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    verification: { storeInDatabase: true },
    advanced: {
      cookiePrefix: 'monzo',
      useSecureCookies: config.secureCookies,
      ipAddress: {
        ipAddressHeaders: process.env.VERCEL ? ['x-vercel-forwarded-for'] : ['x-forwarded-for'],
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 8 },
        '/sign-up/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 60, max: 3 },
        '/send-verification-email': { window: 60, max: 3 },
      },
    },
  });
}
export function getAuth() {
  return (instance ??= createAuth());
}
