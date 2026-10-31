import type { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';
import { variableSchema, parseValue, type VariableDefinition } from './variables';
import { flowSchema, variableReferences } from './definition';
import { variableExample } from './examples';
import { FlowError } from './errors';
export const registryMutation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('example') }).strict(),
  z.object({ action: z.literal('create'), variable: variableSchema }).strict(),
  z
    .object({
      action: z.literal('update'),
      id: z.string().max(128),
      revision: z.number().int().min(1),
      variable: variableSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('delete'),
      id: z.string().max(128),
      revision: z.number().int().min(1),
    })
    .strict(),
]);
export function variableDefinition(row: {
  identifier: string;
  name: string;
  type: string;
  description: string;
  defaultValue: string | null;
  scope: string;
  currency: string;
}): VariableDefinition {
  return variableSchema.parse({
    identifier: row.identifier,
    name: row.name,
    type: row.type,
    description: row.description,
    defaultValue: row.defaultValue,
    scope: row.scope,
    currency: row.currency,
  });
}
export async function registryRows(db: PrismaClient | Prisma.TransactionClient, tenantId: string) {
  const [rows, flows] = await Promise.all([
    db.automationVariable.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
    db.automationFlow.findMany({
      where: { tenantId },
      select: { accountId: true, draft: true, published: true },
    }),
  ]);
  const snapshots = flows.flatMap((flow) =>
    ['draft', 'published'].flatMap((version) => {
      const graph = flowSchema.safeParse(version === 'draft' ? flow.draft : flow.published);
      return graph.success ? [{ accountId: flow.accountId, version, graph: graph.data }] : [];
    }),
  );
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    references: snapshots.flatMap((snapshot) =>
      variableReferences(snapshot.graph, row.identifier).map((step) => ({
        accountId: snapshot.accountId,
        version: snapshot.version,
        step,
      })),
    ),
  }));
}

export async function mutateVariable(
  db: PrismaClient,
  tenantId: string,
  userId: string,
  input: unknown,
) {
  const data = registryMutation.parse(input);
  if (
    data.action !== 'delete' &&
    data.action !== 'example' &&
    data.variable.defaultValue !== null
  ) {
    try {
      parseValue(data.variable, data.variable.defaultValue);
    } catch (e) {
      throw new FlowError(400, e instanceof Error ? e.message : 'Valor predeterminado inválido.');
    }
  }
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Tenant" WHERE "id"=${tenantId} FOR UPDATE`;
    const member = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    if (!member || member.role === 'MEMBER')
      throw new FlowError(403, 'Solo propietarios y administradores pueden editar variables.');
    if (data.action === 'example') {
      const current = (await tx.automationVariable.findMany({ where: { tenantId } })).map(
        variableDefinition,
      );
      const example = variableExample(current);
      const missing = example.definitions.filter(
        (d) => !current.some((c) => c.identifier === d.identifier),
      );
      if (current.length + missing.length > 100)
        throw new FlowError(
          409,
          'El ejemplo requiere espacio para sus variables (máximo 100 por empresa).',
        );
      for (const def of missing) await tx.automationVariable.create({ data: { tenantId, ...def } });
      return example.graph;
    }
    if (data.action === 'create') {
      if ((await tx.automationVariable.count({ where: { tenantId } })) >= 100)
        throw new FlowError(409, 'El máximo es de 100 variables por empresa.');
      if (
        await tx.automationVariable.findUnique({
          where: { tenantId_identifier: { tenantId, identifier: data.variable.identifier } },
        })
      )
        throw new FlowError(409, 'Ya existe una variable con ese identificador.');
      return tx.automationVariable.create({ data: { tenantId, ...data.variable } });
    }
    const row = (await registryRows(tx, tenantId)).find((v) => v.id === data.id);
    if (!row) throw new FlowError(404, 'La variable no está disponible en esta empresa.');
    if (row.revision !== data.revision)
      throw new FlowError(
        409,
        'La variable cambió en otra sesión. Recargá el listado; tus cambios se conservan.',
      );
    if (
      row.references.length &&
      (data.action === 'delete' ||
        row.identifier !== data.variable.identifier ||
        row.type !== data.variable.type)
    )
      throw new FlowError(
        409,
        `La variable está en uso en ${row.references.length} pasos guardados o publicados. Quitá esas referencias antes de eliminarla o cambiar su identificador/tipo.`,
      );
    if (data.action === 'delete') return tx.automationVariable.delete({ where: { id: row.id } });
    const duplicate = await tx.automationVariable.findUnique({
      where: { tenantId_identifier: { tenantId, identifier: data.variable.identifier } },
    });
    if (duplicate && duplicate.id !== row.id)
      throw new FlowError(409, 'Ya existe una variable con ese identificador.');
    return tx.automationVariable.update({
      where: { id: row.id },
      data: { ...data.variable, revision: { increment: 1 } },
    });
  });
}
