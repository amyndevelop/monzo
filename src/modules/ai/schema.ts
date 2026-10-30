import { z } from 'zod';
export const agentSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    instructions: z.string().trim().max(3000),
    knowledge: z.string().trim().max(10000),
    enabled: z.boolean(),
    dailyLimit: z.number().int().min(1).max(50),
    revision: z.number().int().min(0),
  })
  .strict();
export const testSchema = z
  .object({
    question: z.string().trim().min(1).max(2000),
    fictional: z.literal(true),
  })
  .strict();
export const defaultAgent = {
  name: 'Asistente de prueba',
  instructions:
    'Respondé en español, de forma breve y amable. Si falta información, pedí ayuda a una persona.',
  knowledge: '',
  enabled: false,
  dailyLimit: 20,
  revision: 0,
};
export type AgentForm = z.infer<typeof agentSchema>;
export type AgentStatus = {
  agent: AgentForm;
  configured: boolean;
  model: string;
  used: number;
  resetsAt: string;
  canEdit: boolean;
};
