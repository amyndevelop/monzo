import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
try {
  const row = await db.workerHeartbeat.findUnique({ where: { id: 'whatsapp' } });
  if (!row || Date.now() - row.seenAt.getTime() > 45000) process.exitCode = 1;
} catch {
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
