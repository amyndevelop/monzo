import makeWASocket, {
  BufferJSON,
  initAuthCreds,
  proto,
  DisconnectReason,
  jidNormalizedUser,
  normalizeMessageContent,
  generateMessageIDV2,
  type AuthenticationCreds,
  type SignalDataTypeMap,
  type WAMessage,
  type WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import type { PrismaClient, WhatsappWebSession } from '@prisma/client';
import { openSession, sealSession } from './core';
import { captureWebhook, processWebhook } from '../core/ingest';
import { MetaError } from '../core/meta';
// Silent logger: library traces can contain authentication material and message content.
const logger = pino({ level: 'silent' });
export class WebSocketSession {
  socket: WASocket | null = null;
  connected = false;
  closed = false;
  private writes = Promise.resolve();
  private tasks = Promise.resolve();
  constructor(
    private db: PrismaClient,
    readonly session: WhatsappWebSession,
    readonly owner: string,
    private factory: typeof makeWASocket = makeWASocket,
  ) {}
  private fence() {
    return {
      accountId: this.session.accountId,
      generation: this.session.generation,
      leaseOwner: this.owner,
      desiredState: 'CONNECTED',
      leaseUntil: { gt: new Date() },
    };
  }
  private async update(
    data: Parameters<PrismaClient['whatsappWebSession']['updateMany']>[0]['data'],
  ) {
    const result = await this.db.whatsappWebSession.updateMany({ where: this.fence(), data });
    if (result.count !== 1) throw new Error('QR_LEASE_LOST');
  }
  private task(work: () => Promise<void>) {
    this.tasks = this.tasks.then(work).catch(async () => {
      this.connected = false;
      this.closed = true;
      this.socket?.end(new Error('QR_SESSION_FAILED'));
      await this.db.whatsappAccount
        .updateMany({
          where: {
            id: this.session.accountId,
            provider: 'BAILEYS',
            webSession: { generation: this.session.generation, leaseOwner: this.owner },
          },
          data: { enabled: false },
        })
        .catch(() => {});
      await this.db.whatsappWebSession
        .updateMany({
          where: this.fence(),
          data: {
            state: 'ERROR',
            qrEncrypted: null,
            qrExpiresAt: null,
            lastErrorCode: 'SESSION_FAILED',
          },
        })
        .catch(() => {});
    });
  }
  async start() {
    const saved = this.session.authEncrypted
      ? JSON.parse(
          openSession(this.session.authEncrypted, this.session.tenantId, this.session.accountId),
          BufferJSON.reviver,
        )
      : null;
    const store: { creds: AuthenticationCreds; keys: Record<string, unknown> } = saved ?? {
      creds: initAuthCreds(),
      keys: Object.create(null),
    };
    const persist = async () => {
      const encrypted = sealSession(
        JSON.stringify(store, BufferJSON.replacer),
        this.session.tenantId,
        this.session.accountId,
      );
      this.writes = this.writes.then(() => this.update({ authEncrypted: encrypted }));
      await this.writes;
    };
    const socket = this.factory({
      logger,
      auth: {
        creds: store.creds,
        keys: {
          get: async (type, ids) => {
            const data: Record<string, SignalDataTypeMap[typeof type]> = {};
            for (const id of ids) {
              const raw = store.keys[`${type}:${id}`];
              if (raw)
                data[id] = (
                  type === 'app-state-sync-key'
                    ? proto.Message.AppStateSyncKeyData.fromObject(raw as Record<string, unknown>)
                    : raw
                ) as SignalDataTypeMap[typeof type];
            }
            return data;
          },
          set: async (data) => {
            for (const [category, values] of Object.entries(data)) {
              for (const [id, value] of Object.entries(values ?? {})) {
                if (value) store.keys[`${category}:${id}`] = value;
                else delete store.keys[`${category}:${id}`];
              }
            }
            await persist();
          },
        },
      },
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      shouldSyncHistoryMessage: () => false,
      getMessage: async () => undefined,
    });
    this.socket = socket;
    socket.ev.on('creds.update', (update) => {
      Object.assign(store.creds, update);
      this.task(persist);
    });
    socket.ev.on('connection.update', (event) =>
      this.task(async () => {
        if (event.qr) {
          await this.update({
            state: 'QR',
            qrEncrypted: sealSession(event.qr!, this.session.tenantId, this.session.accountId),
            qrExpiresAt: new Date(Date.now() + 45000),
            lastErrorCode: null,
          });
        }
        if (event.connection === 'open') {
          const phone = jidNormalizedUser(socket.user?.id ?? '').split('@')[0];
          if (phone !== this.session.expectedWaId) {
            await socket.logout().catch(() => {});
            await this.update({
              state: 'ERROR',
              desiredState: 'DISCONNECTED',
              authEncrypted: null,
              qrEncrypted: null,
              qrExpiresAt: null,
              lastErrorCode: 'NUMBER_MISMATCH',
            });
            this.closed = true;
            return;
          }
          // Prevent the same number being active in two QR sessions, across tenants.
          await this.db.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`monzo-qr:${phone}`}))::text`;
            const current = await tx.whatsappWebSession.findFirst({ where: this.fence() });
            if (!current) throw new Error('QR_LEASE_LOST');
            const other = await tx.whatsappWebSession.findFirst({
              where: {
                connectedWaId: phone,
                desiredState: 'CONNECTED',
                accountId: { not: this.session.accountId },
              },
            });
            if (other) throw new Error('QR_NUMBER_UNAVAILABLE');
            await tx.whatsappWebSession.update({
              where: { accountId: current.accountId },
              data: {
                state: 'CONNECTED',
                connectedWaId: phone,
                qrEncrypted: null,
                qrExpiresAt: null,
                lastErrorCode: null,
              },
            });
            await tx.whatsappAccount.update({
              where: { id: current.accountId },
              data: { enabled: true, verifiedAt: new Date(), lastErrorCode: null },
            });
          });
          this.connected = true;
        }
        if (event.connection === 'close') {
          this.connected = false;
          this.closed = true;
          const code = (
            event.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
          )?.output?.statusCode;
          const logout = code === DisconnectReason.loggedOut;
          await this.update({
            state: logout ? 'DISCONNECTED' : 'CONNECTING',
            qrEncrypted: null,
            qrExpiresAt: null,
            ...(logout
              ? { authEncrypted: null, desiredState: 'DISCONNECTED', lastErrorCode: 'LOGGED_OUT' }
              : { lastErrorCode: 'RECONNECTING' }),
          });
          await this.db.whatsappAccount.updateMany({
            where: {
              id: this.session.accountId,
              provider: 'BAILEYS',
              webSession: { generation: this.session.generation, leaseOwner: this.owner },
            },
            data: { enabled: false },
          });
        }
      }),
    );
    socket.ev.on('messages.upsert', (event) => {
      if (event.type === 'notify')
        this.task(async () => {
          for (const message of event.messages) await this.incoming(message);
        });
    });
    socket.ev.on('messages.update', (updates) =>
      this.task(async () => {
        for (const { key, update } of updates) {
          if (!key.fromMe || !key.id || !update.status) continue;
          const status =
            update.status >= 4
              ? 'read'
              : update.status === 3
                ? 'delivered'
                : update.status === 2
                  ? 'sent'
                  : null;
          if (status)
            await this.capture({
              statuses: [{ id: key.id, status, timestamp: String(Math.floor(Date.now() / 1000)) }],
            });
        }
      }),
    );
  }
  private async capture(value: Record<string, unknown>) {
    if (
      !this.connected ||
      this.closed ||
      !(await this.db.whatsappWebSession.findFirst({
        where: this.fence(),
        select: { accountId: true },
      }))
    )
      return;
    const account = await this.db.whatsappAccount.findUniqueOrThrow({
      where: { id: this.session.accountId },
    });
    const raw = Buffer.from(
      JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: account.businessAccountId,
            changes: [
              {
                field: 'messages',
                value: { ...value, metadata: { phone_number_id: account.phoneNumberId } },
              },
            ],
          },
        ],
      }),
    );
    for (const event of await captureWebhook(this.db, raw, 'BAILEYS'))
      await processWebhook(this.db, event.id);
  }
  private async incoming(message: WAMessage) {
    if (message.key.fromMe || !message.key.id || !message.key.remoteJid || !message.message) return;
    let jid = message.key.remoteJid;
    if (jid.endsWith('@lid'))
      jid =
        message.key.remoteJidAlt ??
        (await this.socket!.signalRepository.lidMapping.getPNForLID(jid)) ??
        '';
    if (!jid.endsWith('@s.whatsapp.net')) return; // No groups, broadcasts, status or newsletters.
    const phone = jidNormalizedUser(jid).split('@')[0];
    if (!/^[1-9][0-9]{5,14}$/.test(phone)) return;
    const body = normalizeMessageContent(message.message);
    if (!body || body.protocolMessage || body.reactionMessage) return;
    const text = body.conversation ?? body.extendedTextMessage?.text;
    const at = Number(message.messageTimestamp);
    if (!Number.isFinite(at) || at < Math.floor(this.session.createdAt.getTime() / 1000)) return;
    await this.capture({
      contacts: [
        {
          wa_id: phone,
          ...(message.pushName ? { profile: { name: message.pushName.slice(0, 120) } } : {}),
        },
      ],
      messages: [
        {
          id: message.key.id,
          from: phone,
          timestamp: String(at),
          type: typeof text === 'string' ? 'text' : 'unsupported',
          text: {
            body:
              typeof text === 'string'
                ? text.length > 4096
                  ? text.slice(0, 4000) +
                    '\n[Mensaje truncado: excede el límite de 4096 caracteres.]'
                  : text
                : 'Archivo o contenido recibido. Esta conexión QR todavía no permite abrir adjuntos.',
          },
        },
      ],
    });
  }
  async send(generation: number, to: string, text: string, messageId: string) {
    if (
      !this.socket ||
      !this.connected ||
      this.closed ||
      generation !== this.session.generation ||
      !(await this.db.whatsappWebSession.findFirst({
        where: this.fence(),
        select: { accountId: true },
      }))
    )
      throw new MetaError('QR_DISCONNECTED', false);
    if (!/^[1-9][0-9]{5,14}$/.test(to)) throw new MetaError('QR_INVALID_RECIPIENT', false);
    const providerId = generateMessageIDV2(this.socket.user?.id);
    const claim = await this.db.message.updateMany({
      where: { id: messageId, accountId: this.session.accountId, status: 'SENDING' },
      data: { providerId },
    });
    if (claim.count !== 1) throw new MetaError('QR_NOT_CLAIMED', false);
    const result = await this.socket.sendMessage(
      to + '@s.whatsapp.net',
      { text },
      { messageId: providerId },
    );
    if (!result?.key.id) throw new MetaError('QR_RESULT_UNKNOWN', true);
    return result.key.id;
  }
  async flush() {
    await this.tasks;
    await this.writes;
  }
  async stop(logout = false) {
    this.closed = true;
    this.connected = false;
    if (logout) await this.socket?.logout().catch(() => {});
    this.socket?.end(new Error('QR_STOPPED'));
    await this.tasks.catch(() => {});
    await this.writes.catch(() => {});
  }
}
