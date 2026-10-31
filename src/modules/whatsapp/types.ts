import type { TemplatePreview } from './template-types';
export type Channel = {
  id: string;
  phoneNumberId: string;
  businessAccountId: string;
  displayPhone: string;
  displayName: string;
  enabled: boolean;
  hasCredential?: boolean;
  verifiedAt: string | null;
  lastErrorCode: string | null;
};
export type Channels = {
  accounts: Channel[];
  configured: boolean;
  canManage: boolean;
  workerAlive: boolean;
  outboundWorkerAlive: boolean;
  failedEvents: number;
  processorMode: 'bullmq' | 'qstash';
  processorReady: boolean;
  processorIssues: string[];
  pendingJobs: number;
};
export type ChatMessage = {
  automation?: boolean;
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  status: string;
  type: string;
  text: string | null;
  errorCode: string | null;
  occurredAt: string;
  createdAt: string;
  hasMedia: boolean;
  template: TemplatePreview | null;
  mediaMimeType: string | null;
  mediaFilename: string | null;
  mediaSize: number | null;
};
export type ChatSummary = {
  id: string;
  status: 'OPEN' | 'CLOSED';
  unreadCount: number;
  lastMessageAt: string;
  assignedUserId: string | null;
  contact: { id: string; name: string | null; waId: string };
  account: { id: string; displayPhone: string; enabled: boolean };
  messages: ChatMessage[];
};
export type ChatThread = {
  automation?: {
    enabled: boolean;
    paused: boolean;
    variables?: Record<string, string>;
    state: string | null;
    reason: string | null;
  } | null;
  conversation: Omit<ChatSummary, 'messages' | 'lastMessageAt'>;
  messages: ChatMessage[];
  hasMore: boolean;
  notes: { id: string; text: string; createdAt: string; author: { name: string | null } }[];
  members: { user: { id: string; name: string | null } }[];
  replyWindowClosesAt: string | null;
  canReply: boolean;
};
export type ContactItem = {
  id: string;
  name: string | null;
  waId: string;
  account: { displayPhone: string };
  createdAt: string;
  conversations: { id: string; status: string; lastMessageAt: string }[];
};
