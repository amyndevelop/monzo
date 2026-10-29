import 'server-only';
import nodemailer from 'nodemailer';
export async function sendAccountEmail(to: string, subject: string, text: string) {
  const local = ['localhost', '127.0.0.1'].includes(new URL(process.env.BETTER_AUTH_URL!).hostname);
  const host = process.env.SMTP_HOST!;
  if (!local && (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD))
    throw new Error('Production SMTP credentials are required.');
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = process.env.SMTP_SECURE === 'true';
  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !local && !secure,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
  await transport.sendMail({ from: process.env.SMTP_FROM, to, subject, text });
}
