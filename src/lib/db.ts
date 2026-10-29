import 'server-only';
import { PrismaClient } from '@prisma/client';
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
let client: PrismaClient | undefined;
/** Infraestructura de servidor: las consultas de empresa pasan por la capa de acceso. */
export function getDb(): PrismaClient {
  if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL es necesaria para acceder a PostgreSQL.');
  client ??= globalForPrisma.prisma ?? new PrismaClient();
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = client;
  return client;
}
