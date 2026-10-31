import { PrismaClient } from '@prisma/client';
import { processWebhook } from '../../src/modules/whatsapp/core/ingest';
const url = new URL(process.env.DATABASE_URL ?? '');
if (url.hostname !== '127.0.0.1' || url.port !== '55433' || url.pathname !== '/monzo_test')
  throw new Error('Requires isolated local test database.');
const db = new PrismaClient();
try {
  await processWebhook(db, process.argv[2]);
} finally {
  await db.$disconnect();
}
