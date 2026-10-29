import 'server-only';
import { PrismaClient } from '@prisma/client';
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
/** Infraestructura solamente. No exponer consultas sin autorización y tenant verificado (Fase 2). */
export function getDb(): PrismaClient {
  if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL es necesaria para acceder a PostgreSQL.');
  const client = globalForPrisma.prisma ?? new PrismaClient();
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = client;
  return client;
}
