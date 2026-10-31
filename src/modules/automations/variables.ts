import { z } from 'zod';
export const identifierSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/)
  .refine((v) => !['constructor', 'prototype', '__proto__'].includes(v));
export const variableTypes = {
  text: 'Texto',
  integer: 'Número entero',
  decimal: 'Número decimal',
  currency: 'Moneda',
  boolean: 'Sí / No',
  date: 'Fecha',
  datetime: 'Fecha y hora',
  url: 'URL',
} as const;
export const variableSchema = z
  .object({
    identifier: identifierSchema,
    name: z.string().trim().min(1).max(80),
    type: z.enum(['text', 'integer', 'decimal', 'currency', 'boolean', 'date', 'datetime', 'url']),
    description: z.string().trim().max(300).default(''),
    defaultValue: z.string().max(120).nullable().default(null),
    scope: z.literal('execution').default('execution'),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('ARS'),
  })
  .strict();
export type VariableDefinition = z.infer<typeof variableSchema>;
export const assignmentSchema = z
  .object({
    variable: z.string().max(40),
    operation: z.enum(['set', 'clear', 'copy']).default('set'),
    value: z.string().max(120).default(''),
  })
  .strict();
export type Assignment = z.infer<typeof assignmentSchema>;
export type Values = Record<string, string>;
export const operators = {
  equals: 'Es igual a',
  not_equals: 'Es diferente de',
  gt: 'Mayor que',
  lt: 'Menor que',
  gte: 'Mayor o igual que',
  lte: 'Menor o igual que',
  contains: 'Contiene',
  not_contains: 'No contiene',
  empty: 'Está vacío',
  exists: 'No está vacío',
  true: 'Es verdadero',
  false: 'Es falso',
} as const;
export type Operator = keyof typeof operators;
export function allowedOperators(type: VariableDefinition['type']): Operator[] {
  const base: Operator[] = ['equals', 'not_equals', 'empty', 'exists'];
  if (type === 'boolean') return [...base, 'true', 'false'];
  if (['integer', 'decimal', 'currency', 'date', 'datetime'].includes(type))
    return [...base, 'gt', 'lt', 'gte', 'lte'];
  return [...base, 'contains', 'not_contains'];
}
export function parseValue(def: VariableDefinition, raw: string): string {
  const value = raw.trim();
  if (!value || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value))
    throw new Error(
      'Usá un valor de hasta 120 caracteres, sin saltos de línea. No puede quedar vacío.',
    );
  if (def.type === 'text') return value;
  if (['integer', 'decimal', 'currency'].includes(def.type)) {
    const normalized = value.replace(',', '.');
    if (
      !/^[+-]?\d{1,15}(?:\.\d{1,6})?$/.test(normalized) ||
      (def.type === 'integer' && normalized.includes('.'))
    )
      throw new Error(
        def.type === 'integer'
          ? 'Ingresá un entero, sin separadores de miles.'
          : 'Ingresá un número sin separadores de miles, con hasta 6 decimales.',
      );
    const [whole, fraction = ''] = normalized.replace(/^[+-]/, '').split('.');
    const result =
      whole.replace(/^0+(?=\d)/, '') +
      (fraction.replace(/0+$/, '') ? '.' + fraction.replace(/0+$/, '') : '');
    return normalized.startsWith('-') && result !== '0' ? '-' + result : result;
  }
  if (def.type === 'boolean') {
    if (['sí', 'si', 'true', '1'].includes(value.toLowerCase())) return 'true';
    if (['no', 'false', '0'].includes(value.toLowerCase())) return 'false';
    throw new Error('Respondé Sí o No.');
  }
  if (def.type === 'date') {
    const d = new Date(value + 'T00:00:00Z');
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      value < '0001-01-01' ||
      !Number.isFinite(d.getTime()) ||
      d.toISOString().slice(0, 10) !== value
    )
      throw new Error('Usá una fecha real con formato AAAA-MM-DD.');
    return value;
  }
  if (def.type === 'datetime') {
    const d = new Date(value);
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value,
      ) ||
      !Number.isFinite(d.getTime())
    )
      throw new Error('Usá fecha y hora ISO con zona, por ejemplo 2026-12-15T14:30-03:00.');
    const day = value.slice(0, 10);
    parseValue({ ...def, type: 'date' }, day);
    if (
      Number(value.slice(11, 13)) > 23 ||
      Number(value.slice(14, 16)) > 59 ||
      (value[16] === ':' && Number(value.slice(17, 19)) > 59)
    )
      throw new Error('La hora no es válida.');
    if (d.getUTCFullYear() < 1 || d.getUTCFullYear() > 9999)
      throw new Error('La fecha y hora está fuera del rango admitido.');
    return d.toISOString();
  }
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw new Error();
    return value;
  } catch {
    throw new Error('Ingresá una URL http o https sin usuario ni contraseña.');
  }
}
export function defaults(defs: VariableDefinition[]): Values {
  return Object.fromEntries(
    defs
      .filter((d) => d.defaultValue !== null)
      .map((d) => [d.identifier, parseValue(d, d.defaultValue!)]),
  );
}
export function applyAssignments(
  defs: VariableDefinition[],
  values: Values,
  assignments: Assignment[],
) {
  const next = { ...values };
  for (const item of assignments) {
    const def = defs.find((d) => d.identifier === item.variable);
    if (!def) throw new Error(`Variable inexistente: ${item.variable}.`);
    if (item.operation === 'clear') next[item.variable] = '';
    else {
      const raw = item.operation === 'copy' ? next[item.value] : item.value;
      if (raw === undefined)
        throw new Error(`La variable ${item.value} no tiene valor para copiar.`);
      next[item.variable] = parseValue(def, raw);
    }
  }
  return next;
}
export function normalizeValue(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}
function decimalKey(value: string) {
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  return BigInt(whole + fraction.padEnd(6, '0')) * (negative ? -1n : 1n);
}
export function compareValue(
  def: VariableDefinition,
  values: Values,
  operator: Operator,
  expected = '',
) {
  const actual = values[def.identifier];
  if (operator === 'exists') return actual !== undefined && actual !== '';
  if (operator === 'empty') return actual === undefined || actual === '';
  if (actual === undefined || actual === '') return false;
  if (!allowedOperators(def.type).includes(operator))
    throw new Error('La comparación no corresponde al tipo de variable.');
  const a = parseValue(def, actual);
  if (operator === 'true' || operator === 'false') return a === operator;
  const substring = ['contains', 'not_contains'].includes(operator);
  const b = parseValue(substring ? { ...def, type: 'text' } : def, expected);
  let order: number;
  if (['integer', 'decimal', 'currency'].includes(def.type)) {
    const x = decimalKey(a),
      y = decimalKey(b);
    order = x < y ? -1 : x > y ? 1 : 0;
  } else {
    const x = def.type === 'text' ? normalizeValue(a) : def.type === 'url' ? new URL(a).href : a;
    const y =
      def.type === 'text'
        ? normalizeValue(b)
        : def.type === 'url' && !substring
          ? new URL(b).href
          : b;
    order = x < y ? -1 : x > y ? 1 : 0;
    if (operator === 'contains') return x.includes(y);
    if (operator === 'not_contains') return !x.includes(y);
  }
  return (
    (
      {
        equals: order === 0,
        not_equals: order !== 0,
        gt: order > 0,
        lt: order < 0,
        gte: order >= 0,
        lte: order <= 0,
      } as Partial<Record<Operator, boolean>>
    )[operator] ?? false
  );
}
export function formatValue(def: VariableDefinition | undefined, value: string) {
  if (def?.type === 'boolean') return value === 'true' ? 'Sí' : 'No';
  // Keep exact numeric precision; currency denomination is explicit rather than rounded by Number.
  if (def?.type === 'currency') return `${value} ${def.currency}`;
  return value;
}
export const sampleValue = (def: VariableDefinition) =>
  def.defaultValue ??
  {
    text: 'Ejemplo',
    integer: '1000',
    decimal: '12.5',
    currency: '15400',
    boolean: 'true',
    date: '2026-12-15',
    datetime: '2026-12-15T17:30:00.000Z',
    url: 'https://example.com',
  }[def.type];
