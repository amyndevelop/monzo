import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(value + 'T00:00:00Z');
    return (
      value >= '1970-01-01' &&
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  });
const querySchema = z
  .object({
    from: date.optional(),
    to: date.optional(),
    days: z.enum(['7', '30', '90']).optional(),
    accountId: z.string().min(1).max(128).optional(),
  })
  .strict();
export class AnalyticsError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function dayInZone(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  return ['year', 'month', 'day']
    .map((type) => parts.find((p) => p.type === type)!.value)
    .join('-');
}
export function analyticsFilters(input: unknown, timezone: string, now: Date) {
  const query = querySchema.parse(input);
  if (Boolean(query.from) !== Boolean(query.to) || (query.days && query.from))
    throw new AnalyticsError(400, 'Elegí un período rápido o completá ambas fechas.');
  const today = dayInZone(now, timezone);
  const to = query.to ?? today;
  const from =
    query.from ??
    new Date(Date.parse(to + 'T00:00:00Z') - (Number(query.days ?? '7') - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
  const length = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (length < 1 || length > 90 || to > today)
    throw new AnalyticsError(400, 'Elegí entre 1 y 90 días, sin fechas futuras.');
  return { from, to, accountId: query.accountId ?? '', timezone };
}
const accepted = new Set(['SENT', 'DELIVERED', 'READ']);
export async function loadAnalytics(
  db: PrismaClient,
  tenantId: string,
  input: unknown,
  now = new Date(),
) {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('statement_timeout', '5000', true), set_config('TimeZone', 'UTC', true)`;
      const settings = await tx.tenantSettings.findUnique({
        where: { tenantId },
        select: { timezone: true },
      });
      let timezone = settings?.timezone ?? 'America/Argentina/Buenos_Aires';
      try {
        timezone = new Intl.DateTimeFormat('es-AR', { timeZone: timezone }).resolvedOptions()
          .timeZone;
      } catch {
        timezone = 'America/Argentina/Buenos_Aires';
      }
      const filters = analyticsFilters(input, timezone, now);
      const zone = /^[+-]/.test(timezone)
        ? Prisma.sql`${timezone}::interval`
        : Prisma.sql`${timezone}`;
      const accounts = await tx.whatsappAccount.findMany({
        where: { tenantId },
        select: { id: true, displayName: true, displayPhone: true },
        orderBy: { createdAt: 'asc' },
      });
      if (filters.accountId && !accounts.some((a) => a.id === filters.accountId))
        throw new AnalyticsError(404, 'El canal no está disponible en esta empresa.');
      const [bounds] = await tx.$queryRaw<
        { start: Date; end: Date }[]
      >`SELECT (${filters.from}::date::timestamp AT TIME ZONE ${zone}) AS start, ((${filters.to}::date + 1)::timestamp AT TIME ZONE ${zone}) AS end`;
      const start = bounds.start;
      const end = new Date(Math.min(bounds.end.getTime(), now.getTime()));
      const channel = filters.accountId
        ? Prisma.sql`AND "accountId" = ${filters.accountId}`
        : Prisma.empty;
      const where = Prisma.sql`"tenantId" = ${tenantId} AND "createdAt" >= ${start} AND "createdAt" < ${end} ${channel}`;
      const [groups, days, flowGroups, conversations, newConversations] = await Promise.all([
        tx.$queryRaw<
          { accountId: string; direction: string; status: string; count: bigint }[]
        >`SELECT "accountId", direction, status, COUNT(*) AS count FROM "Message" WHERE ${where} GROUP BY "accountId", direction, status`,
        tx.$queryRaw<{ date: string; inbound: bigint; outbound: bigint }[]>`WITH activity AS (
        SELECT ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${zone})::date AS day,
          COUNT(*) FILTER (WHERE direction = 'INBOUND') AS inbound,
          COUNT(*) FILTER (WHERE direction = 'OUTBOUND') AS outbound
        FROM "Message" WHERE ${where} GROUP BY day
      ) SELECT to_char(d.day, 'YYYY-MM-DD') AS date, COALESCE(a.inbound,0) AS inbound, COALESCE(a.outbound,0) AS outbound
        FROM generate_series(${filters.from}::date::timestamp, ${filters.to}::date::timestamp, interval '1 day') AS d(day)
        LEFT JOIN activity a ON a.day = d.day::date ORDER BY d.day`,
        tx.$queryRaw<
          { accountId: string; kind: string | null; status: string; count: bigint }[]
        >`SELECT "accountId", "automationSnapshot"->>'kind' AS kind, status, COUNT(*) AS count
        FROM "Message" WHERE ${where} AND direction = 'OUTBOUND' AND "automationFlowId" IS NOT NULL GROUP BY "accountId", kind, status`,
        tx.$queryRaw<
          { status: string; unassigned: boolean; count: bigint }[]
        >`SELECT c.status, (c."assignedUserId" IS NULL) AS unassigned, COUNT(*) AS count FROM "Conversation" c
        WHERE c."tenantId" = ${tenantId} AND c.id IN (SELECT "conversationId" FROM "Message" WHERE ${where}) GROUP BY c.status, unassigned`,
        tx.conversation.count({
          where: {
            tenantId,
            ...(filters.accountId ? { accountId: filters.accountId } : {}),
            createdAt: { gte: start, lt: end },
          },
        }),
      ]);
      const statusCounts: Record<string, number> = Object.fromEntries(
        ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'UNKNOWN', 'CANCELED'].map(
          (s) => [s, 0],
        ),
      );
      let inbound = 0;
      const channels = accounts
        .filter((a) => !filters.accountId || a.id === filters.accountId)
        .map((a) => ({ ...a, inbound: 0, outbound: 0, accepted: 0, failed: 0, unknown: 0 }));
      for (const group of groups) {
        const n = Number(group.count);
        const item = channels.find((a) => a.id === group.accountId)!;
        if (group.direction === 'INBOUND') {
          inbound += n;
          item.inbound += n;
        } else {
          statusCounts[group.status] = (statusCounts[group.status] ?? 0) + n;
          item.outbound += n;
          if (accepted.has(group.status)) item.accepted += n;
          if (group.status === 'FAILED') item.failed += n;
          if (group.status === 'UNKNOWN') item.unknown += n;
        }
      }
      const flows = channels.map((a) => ({
        accountId: a.id,
        displayName: a.displayName,
        displayPhone: a.displayPhone,
        registered: 0,
        accepted: 0,
        menus: 0,
        captures: 0,
        finals: 0,
        handoffs: 0,
        failed: 0,
        unknown: 0,
        pending: 0,
        canceled: 0,
      }));
      for (const group of flowGroups) {
        const item = flows.find((a) => a.accountId === group.accountId)!;
        const n = Number(group.count);
        item.registered += n;
        if (accepted.has(group.status)) {
          item.accepted += n;
          if (group.kind === 'menu') item.menus += n;
          if (group.kind === 'capture') item.captures += n;
          if (group.kind === 'message') item.finals += n;
          if (group.kind === 'handoff') item.handoffs += n;
        }
        if (group.status === 'FAILED') item.failed += n;
        if (group.status === 'UNKNOWN') item.unknown += n;
        if (['QUEUED', 'SENDING'].includes(group.status)) item.pending += n;
        if (group.status === 'CANCELED') item.canceled += n;
      }
      const active = conversations.reduce((n, g) => n + Number(g.count), 0);
      const open = conversations
        .filter((g) => g.status === 'OPEN')
        .reduce((n, g) => n + Number(g.count), 0);
      return {
        filters,
        asOf: now.toISOString(),
        accounts,
        channels,
        conversations: {
          active,
          new: newConversations,
          open,
          closed: active - open,
          unassigned: conversations
            .filter((g) => g.status === 'OPEN' && g.unassigned)
            .reduce((n, g) => n + Number(g.count), 0),
        },
        messages: {
          inbound,
          outbound: Object.values(statusCounts).reduce((a, b) => a + b, 0),
          accepted: statusCounts.SENT + statusCounts.DELIVERED + statusCounts.READ,
          delivered: statusCounts.DELIVERED + statusCounts.READ,
          read: statusCounts.READ,
          statuses: statusCounts,
        },
        days: days.map((d) => ({
          date: d.date,
          inbound: Number(d.inbound),
          outbound: Number(d.outbound),
        })),
        flows: flows.filter((f) => f.registered > 0),
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 15000,
      maxWait: 5000,
    },
  );
}
export type AnalyticsReport = Awaited<ReturnType<typeof loadAnalytics>>;
