export type EvolutionStatus = {
  configured: boolean;
  canCheck: boolean;
  configurationMessage: string;
};
export type EvolutionReport = {
  ok: boolean;
  checkedAt: string;
  checks: { name: 'service' | 'credential' | 'callback'; ok: boolean; message: string }[];
};
