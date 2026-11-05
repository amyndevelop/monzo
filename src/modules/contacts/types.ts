export const salesStages = {
  NEW: 'Nuevo',
  FOLLOW_UP: 'En seguimiento',
  CLOSED: 'Cerrado',
} as const;
export type SalesStage = keyof typeof salesStages;
export type ContactProfile = {
  id: string;
  name: string | null;
  waId: string;
  crmName: string | null;
  email: string | null;
  company: string | null;
  salesStage: SalesStage;
  tags: string[];
  ownerUserId: string | null;
  profileNotes: string | null;
  crmRevision: number;
  account: { displayPhone: string };
  owner: { id: string; name: string | null } | null;
  conversations: { id: string; status: string; lastMessageAt: string }[];
};
export type ContactDetail = {
  contact: ContactProfile;
  members: { user: { id: string; name: string | null } }[];
  canAssign: boolean;
  userId: string;
  answers: { identifier: string; label: string; value: string; conversationId: string }[];
};
