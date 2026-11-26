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
export type EvolutionChannelRow = {
  accountId: string;
  name: string;
  generation: number;
  state: string;
  desiredState: string;
  expectedWaId: string;
  connectedWaId: string | null;
  qr: string | null;
  qrExpiresAt: string | null;
  lastSeenAt: string | null;
  lastErrorCode: string | null;
};
export type EvolutionChannelList = {
  enabled: boolean;
  configured: boolean;
  canManage: boolean;
  sessions: EvolutionChannelRow[];
  serverTime: number;
};
