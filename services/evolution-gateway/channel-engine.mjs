import { createHash } from 'node:crypto';
import {
  instanceClient,
  instanceScope,
  instanceEventToken,
  InstanceError,
} from './instance-client.mjs';
import { sameSecret, PROTOCOL, outboundMessageId } from './protocol.mjs';
import { providerCandidates, attestCandidate } from './provider-events.mjs';
import { relayEvents } from './event-relay.mjs';
import { StoreError } from './durable-store.mjs';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const codes = new Set([
  'NUMBER_MISMATCH',
  'INSTANCE_IDENTITY_UNAVAILABLE',
  'INSTANCE_UNREACHABLE',
  'QR_NOT_READY',
  'INSTANCE_RESULT_UNKNOWN',
  'INSTANCE_REJECTED',
  'EVOLUTION_AUTH',
  'PROCESS_INTERRUPTED',
]);
export class ChannelError extends StoreError {
  constructor(code, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export class ChannelEngine {
  #store;
  #client;
  #config;
  #clock;
  #locks = new Map();
  #pollCursor = 0;
  constructor(config, { store, client = instanceClient(config), clock = Date.now }) {
    this.#config = config;
    this.#store = store;
    this.#client = client;
    this.#clock = clock;
  }
  async #locked(scope, work) {
    const key = scope.tenantId + ':' + scope.accountId;
    const previous = this.#locks.get(key) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(work);
    this.#locks.set(key, task);
    try {
      return await task;
    } finally {
      if (this.#locks.get(key) === task) this.#locks.delete(key);
    }
  }
  #public(record) {
    const data = record.data,
      now = this.#clock();
    return {
      protocol: PROTOCOL,
      scope: record.scope,
      state: data.state ?? 'DISCONNECTED',
      desiredState: data.desiredState ?? 'DISCONNECTED',
      connectedPhone: data.connectedPhone ?? null,
      lastSeenAt: data.lastSeenAt ?? null,
      lastErrorCode: data.lastErrorCode ?? null,
      qr: data.state === 'QR' && data.qrExpiresAt > now ? data.qr : null,
      qrExpiresAt: data.state === 'QR' && data.qrExpiresAt > now ? data.qrExpiresAt : null,
    };
  }
  status(input) {
    const { name, ...scope } = instanceScope(input);
    void name;
    return this.#public(this.#store.account(scope));
  }
  command(input) {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).sort().join(',') !==
        (input.operation === 'send'
          ? 'commandId,data,deadline,operation,scope'
          : 'commandId,deadline,operation,scope') ||
      typeof input.commandId !== 'string' ||
      !/^[a-zA-Z0-9:_-]{1,128}$/.test(input.commandId) ||
      !['connect', 'refresh', 'disconnect', 'send'].includes(input.operation) ||
      !Number.isSafeInteger(input.deadline)
    )
      throw new ChannelError('INVALID_COMMAND', 400);
    const { name, ...scope } = instanceScope(input.scope);
    void name;
    const payload = { operation: input.operation, deadline: input.deadline };
    if (input.operation === 'send') {
      const data = input.data;
      if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data) ||
        Object.keys(data).sort().join(',') !== 'messageId,providerId,text,to' ||
        typeof data.messageId !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(data.messageId) ||
        input.commandId !== 'message:' + data.messageId ||
        typeof data.to !== 'string' ||
        !/^[1-9][0-9]{5,14}$/.test(data.to) ||
        data.to === scope.expectedPhone ||
        typeof data.text !== 'string' ||
        !data.text.trim() ||
        data.text.length > 4096 ||
        data.providerId !==
          outboundMessageId(
            this.#config.gatewayKey,
            scope.tenantId,
            scope.accountId,
            data.messageId,
          )
      )
        throw new ChannelError('INVALID_MESSAGE', 400);
      payload.data = data;
    }
    return this.#store.atomic(() => {
      const existing = this.#store.record(scope, 'command', input.commandId);
      // Retry metadata must not extend the first accepted deadline. Logical
      // scope/operation/content still pass the journal's idempotency check.
      if (
        existing &&
        existing.scope.generation === scope.generation &&
        existing.payload.operation === input.operation
      )
        payload.deadline = existing.payload.deadline;
      if (!existing && (input.deadline < this.#clock() || input.deadline > this.#clock() + 120000))
        throw new ChannelError('COMMAND_EXPIRED');
      const previous = this.#store.latest(scope);
      if (
        !existing &&
        input.operation !== 'disconnect' &&
        this.#store
          .accounts()
          .some(
            (account) =>
              account.scope.expectedPhone === scope.expectedPhone &&
              (account.scope.accountId !== scope.accountId ||
                account.scope.tenantId !== scope.tenantId) &&
              (account.data.desiredState === 'CONNECTED' || !account.data.closed),
          )
      )
        throw new ChannelError('PHONE_IN_USE');
      if (!existing && input.operation === 'refresh' && previous?.data.desiredState !== 'CONNECTED')
        throw new ChannelError('DISCONNECTED');
      if (!previous || scope.generation > previous.scope.generation) {
        if (input.operation !== 'connect') throw new ChannelError('STALE_GENERATION');
        if (!previous && this.#store.accounts().length >= 8)
          throw new ChannelError('CHANNEL_CAPACITY', 429);
        this.#store.register(scope, {
          state: 'DISCONNECTED',
          desiredState: 'DISCONNECTED',
          closed: true,
        });
      }
      const record = this.#store.enqueue(scope, 'command', input.commandId, payload);
      if (!existing && input.operation !== 'send') {
        const current = this.#store.account(scope);
        const disconnect = input.operation === 'disconnect';
        this.#store.updateAccount(scope, {
          ...current.data,
          desiredState: disconnect ? 'DISCONNECTED' : 'CONNECTED',
          state: disconnect
            ? 'DISCONNECTING'
            : current.data.state === 'CONNECTED'
              ? 'CONNECTED'
              : 'CONNECTING',
          qr: null,
          qrExpiresAt: null,
          lastErrorCode: null,
          commandId: input.commandId,
          ...(disconnect ? {} : { closed: false }),
        });
      }
      return {
        protocol: PROTOCOL,
        commandId: input.commandId,
        state: record.result?.state ?? 'ACCEPTED',
      };
    });
  }
  #apply(scope, status, code = null) {
    const current = this.#store.account(scope),
      now = this.#clock();
    const previous = current.data;
    let state = status.state === 'NOT_CREATED' ? 'DISCONNECTED' : status.state;
    if (
      state === 'DISCONNECTED' &&
      previous.desiredState === 'CONNECTED' &&
      previous.commandId &&
      ['PENDING', 'PROCESSING'].includes(
        this.#store.record(scope, 'command', previous.commandId)?.state,
      )
    )
      state = 'CONNECTING';
    const data = {
      ...previous,
      state,
      lastSeenAt: now,
      lastErrorCode: code,
      connectedPhone: null,
      qr: null,
      qrExpiresAt: null,
    };
    if (state === 'CONNECTED') {
      if (status.connectedPhone !== scope.expectedPhone) throw new InstanceError('NUMBER_MISMATCH');
      data.connectedPhone = status.connectedPhone;
      data.verifiedPhone = status.connectedPhone;
      data.verifiedAt = now;
      data.closed = false;
      if (data.desiredState !== 'CONNECTED') data.state = 'DISCONNECTING';
    }
    if (state === 'QR') {
      data.qr = status.qr;
      data.qrCodeHash = hash(status.qr);
      data.qrIssuedAt = previous.qrCodeHash === data.qrCodeHash ? previous.qrIssuedAt : now;
      data.qrExpiresAt = data.qrIssuedAt + 45000;
      if (data.qrExpiresAt <= now) {
        data.state = 'CONNECTING';
        data.qr = null;
        data.qrExpiresAt = null;
        data.lastErrorCode = 'QR_EXPIRED';
      }
    } else if (
      ['CONNECTING', 'DISCONNECTED'].includes(state) &&
      data.desiredState === 'CONNECTED' &&
      previous.state === 'QR' &&
      previous.qrExpiresAt > now
    ) {
      data.state = 'QR';
      data.qr = previous.qr;
      data.qrExpiresAt = previous.qrExpiresAt;
    }
    if (data.desiredState === 'DISCONNECTED') {
      if (!['DISCONNECTED', 'ERROR'].includes(data.state)) data.state = 'DISCONNECTING';
      data.connectedPhone = null;
      data.qr = null;
      data.qrExpiresAt = null;
      if (['NOT_CREATED', 'DISCONNECTED'].includes(status.state)) data.closed = true;
    }
    const payload = {
      type: 'connection',
      state: data.state,
      observedAt: now,
      ...(data.state === 'CONNECTED' ? { connectedPhone: data.connectedPhone } : {}),
      ...(data.state === 'QR' ? { qr: data.qr, qrExpiresAt: data.qrExpiresAt } : {}),
      ...(codes.has(data.lastErrorCode) ? { code: data.lastErrorCode } : {}),
    };
    // Persist state and notification atomically, then let the relay deliver it.
    this.#store.atomic(() => {
      this.#store.updateAccount(scope, data);
      this.#store.enqueue(scope, 'event', 'state:' + hash(payload), payload);
    });
    return data;
  }
  async #closePrior(scope) {
    for (const prior of this.#store.priorInstances(scope)) {
      if (prior.data.closed) continue;
      const state = await this.#client.disconnect(prior.scope);
      if (!['NOT_CREATED', 'DISCONNECTED'].includes(state.state))
        throw new InstanceError('INSTANCE_DISCONNECT_PENDING');
      this.#store.updateInstance(prior.scope, {
        ...prior.data,
        state: 'DISCONNECTED',
        desiredState: 'DISCONNECTED',
        closed: true,
        qr: null,
        qrExpiresAt: null,
      });
    }
  }
  async drainCommands() {
    for (const result of this.#store.pendingResults())
      this.#store.atomic(() => {
        if (result.payload.operation === 'send') {
          this.#notifySend(
            result,
            result.result ?? { state: 'UNKNOWN', code: 'PROCESS_INTERRUPTED' },
          );
          return;
        }
        const latest = this.#store.latest(result.scope);
        if (latest?.scope.generation === result.scope.generation)
          this.#apply(result.scope, { state: 'ERROR' }, 'PROCESS_INTERRUPTED');
        this.#store.markNotified(result.id);
      });
    const records = this.#store.claim('command', { limit: 4, leaseMs: 120000 });
    return Promise.all(
      records.map((record) =>
        this.#locked(record.scope, async () => {
          const scope = record.scope;
          let result;
          try {
            const current = this.#store.account(scope);
            if (record.payload.deadline < this.#clock())
              result = { state: 'CANCELED', code: 'COMMAND_EXPIRED' };
            else if (
              record.payload.operation !== 'disconnect' &&
              current.data.desiredState !== 'CONNECTED'
            )
              result = { state: 'CANCELED', code: 'DISCONNECT_REQUESTED' };
            else {
              let status;
              if (record.payload.operation === 'send') {
                const check = await this.#client.status(scope);
                if (check.state !== 'CONNECTED' || check.connectedPhone !== scope.expectedPhone)
                  throw new InstanceError('CHANNEL_NOT_CONNECTED');
                const { messageId, ...data } = record.payload.data;
                void messageId;
                const providerId = await this.#client.sendText(scope, data);
                result = { state: 'DONE', code: 'OK', providerId };
              } else if (record.payload.operation === 'disconnect') {
                status = await this.#client.disconnect(scope);
                if (!['NOT_CREATED', 'DISCONNECTED'].includes(status.state))
                  throw new InstanceError('INSTANCE_DISCONNECT_PENDING', true);
                this.#store.updateAccount(scope, {
                  ...this.#store.account(scope).data,
                  closed: true,
                });
              } else {
                await this.#closePrior(scope);
                status = await this.#client.create(scope);
                if (status.state !== 'CONNECTED') status = await this.#client.connect(scope);
              }
              // A newer request can be accepted while a provider call is in flight.
              // Preserve its desired state and never overwrite a newer generation.
              if (status) {
                this.#apply(scope, status);
                result = { state: 'DONE', code: 'OK' };
              }
            }
          } catch (error) {
            const code = codes.has(error.code) ? error.code : 'INSTANCE_UNREACHABLE';
            result = {
              state:
                error.uncertain ||
                (record.payload.operation === 'send' && !(error instanceof InstanceError))
                  ? 'UNKNOWN'
                  : 'FAILED',
              code: record.payload.operation === 'send' ? (error.code ?? 'RESULT_UNKNOWN') : code,
            };
            const latest = this.#store.latest(scope);
            if (record.payload.operation === 'send' && error.code === 'NUMBER_MISMATCH') {
              await this.#client.disconnect(scope).catch(() => {});
              if (latest?.scope.generation === scope.generation)
                this.#apply(scope, { state: 'ERROR' }, 'NUMBER_MISMATCH');
            }
            if (
              latest?.scope.generation === scope.generation &&
              record.payload.operation !== 'send'
            )
              this.#apply(scope, { state: 'ERROR' }, code);
          }
          if (
            result.state === 'CANCELED' &&
            record.payload.operation !== 'send' &&
            this.#store.latest(scope)?.scope.generation === scope.generation
          )
            this.#apply(scope, { state: 'ERROR' }, 'INSTANCE_REJECTED');
          this.#store.atomic(() => {
            if (!this.#store.finish(record.id, record.leaseToken, result))
              throw new StoreError('STORAGE_LEASE_LOST');
            if (record.payload.operation === 'send') {
              this.#notifySend(record, result);
              return;
            }
            this.#store.markNotified(record.id);
            const current = this.#store.latest(scope);
            if (
              current?.scope.generation === scope.generation &&
              current.data.commandId === record.key
            )
              this.#store.updateAccount(scope, { ...current.data, commandId: null });
          });
          return { id: record.id, ...result };
        }),
      ),
    );
  }
  #notifySend(record, result) {
    const data = record.payload.data;
    const status =
      { DONE: 'SENT', FAILED: 'FAILED', UNKNOWN: 'UNKNOWN', CANCELED: 'CANCELED' }[result.state] ??
      'UNKNOWN';
    const known = new Set([
      'OK',
      'RESULT_UNKNOWN',
      'CHANNEL_NOT_CONNECTED',
      'COMMAND_EXPIRED',
      'GENERATION_CHANGED',
      'PROCESS_INTERRUPTED',
    ]);
    const code =
      result.code === 'DISCONNECT_REQUESTED'
        ? 'CHANNEL_NOT_CONNECTED'
        : known.has(result.code)
          ? result.code
          : status === 'UNKNOWN'
            ? 'RESULT_UNKNOWN'
            : 'PROVIDER_REJECTED';
    this.#store.enqueue(record.scope, 'event', 'send-result:' + record.id, {
      type: 'sendResult',
      messageId: data.messageId,
      providerId: data.providerId,
      peer: data.to,
      status,
      code,
      occurredAt: this.#clock(),
    });
    this.#store.markNotified(record.id);
  }
  capture(raw, authorization) {
    if (
      !raw ||
      typeof raw.instance !== 'string' ||
      !/^Bearer [a-f0-9]{64}$/.test(authorization ?? '')
    )
      throw new ChannelError('UNAUTHORIZED', 401);
    const instance = this.#store.byInstance(raw.instance);
    if (
      !instance ||
      !sameSecret(authorization.slice(7), instanceEventToken(this.#config, instance.scope))
    )
      throw new ChannelError('UNAUTHORIZED', 401);
    const candidates = providerCandidates(raw, instance.scope, this.#clock());
    this.#store.atomic(() => {
      for (const { key, candidate } of candidates) {
        // Repeated delivery of the same raw QR must not extend its lifetime.
        if (key.startsWith('qr:') && this.#store.record(instance.scope, 'event', key)) continue;
        this.#store.enqueue(instance.scope, 'event', key, { candidate });
      }
    });
    return { accepted: candidates.length };
  }
  async #prepare(record) {
    if (!record.payload.candidate)
      return this.#store.prepareEvent(record.id, record.leaseToken, record.payload);
    return this.#locked(record.scope, async () => {
      const candidate = record.payload.candidate,
        scope = record.scope;
      const latest = this.#store.latest(scope);
      const retired = latest.scope.generation !== scope.generation;
      const historic = this.#store.byInstance(instanceScope(scope).name);
      if (candidate.type === 'connection' && candidate.state !== 'CONNECTED') {
        let payload = candidate;
        if (!retired)
          this.#store.atomic(() => {
            const data = { ...this.#store.account(scope).data };
            if (candidate.state === 'QR') {
              const fingerprint = hash(candidate.qr);
              data.qrIssuedAt =
                data.qrCodeHash === fingerprint
                  ? Math.min(data.qrIssuedAt, candidate.observedAt)
                  : candidate.observedAt;
              data.qrCodeHash = fingerprint;
              const expires = data.qrIssuedAt + 45000;
              payload =
                data.desiredState !== 'CONNECTED'
                  ? { type: 'connection', state: 'DISCONNECTING', observedAt: this.#clock() }
                  : expires <= this.#clock()
                    ? {
                        type: 'connection',
                        state: 'CONNECTING',
                        code: 'QR_NOT_READY',
                        observedAt: this.#clock(),
                      }
                    : { ...candidate, qrExpiresAt: expires };
            }
            Object.assign(data, {
              state: payload.state,
              qr: payload.qr ?? null,
              qrExpiresAt: payload.qrExpiresAt ?? null,
              connectedPhone: null,
              lastSeenAt: Math.max(data.lastSeenAt ?? 0, payload.observedAt),
              lastErrorCode: payload.code ?? null,
            });
            this.#store.updateAccount(scope, data);
          });
        return this.#store.prepareEvent(record.id, record.leaseToken, payload);
      }
      let proof;
      if (
        retired &&
        candidate.type === 'receipt' &&
        historic.data.verifiedPhone === scope.expectedPhone
      )
        proof = {
          state: 'CONNECTED',
          connectedPhone: historic.data.verifiedPhone,
          verifiedAt: historic.data.verifiedAt,
        };
      else {
        try {
          proof = { ...(await this.#client.status(scope)), verifiedAt: this.#clock() };
        } catch (error) {
          if (error.code !== 'NUMBER_MISMATCH') throw error;
          // Close the accidentally linked number before emitting an error. Its
          // private message content must never be relayed to the expected owner.
          await this.#client.disconnect(scope);
          const payload = {
            type: 'connection',
            state: 'ERROR',
            code: 'NUMBER_MISMATCH',
            observedAt: this.#clock(),
          };
          if (!retired) this.#apply(scope, { state: 'ERROR' }, 'NUMBER_MISMATCH');
          return this.#store.prepareEvent(record.id, record.leaseToken, payload);
        }
      }
      if (proof.state !== 'CONNECTED' && (retired || latest.data.desiredState === 'DISCONNECTED'))
        return this.#store.prepareEvent(record.id, record.leaseToken, {
          type: 'connection',
          state: 'DISCONNECTED',
          observedAt: this.#clock(),
        });
      const payload = attestCandidate(candidate, scope, proof);
      return this.#store.prepareEvent(record.id, record.leaseToken, payload);
    });
  }
  async relay(options = {}) {
    return relayEvents(this.#store, this.#config, {
      ...options,
      clock: this.#clock,
      prepare: (record) => this.#prepare(record),
    });
  }
  async poll() {
    const accounts = this.#store.accounts();
    const batch = [];
    for (let i = 0; i < Math.min(4, accounts.length); i++)
      batch.push(accounts[(this.#pollCursor + i) % accounts.length]);
    this.#pollCursor = accounts.length ? (this.#pollCursor + batch.length) % accounts.length : 0;
    return Promise.all(
      batch.map((record) =>
        this.#locked(record.scope, async () => {
          const scope = record.scope;
          // Requests accepted while this poll was waiting may replace the instance.
          if (this.#store.latest(scope)?.scope.generation !== scope.generation) return;
          const fresh = this.#store.account(scope);
          if (fresh.data.lastErrorCode === 'NUMBER_MISMATCH') {
            this.#apply(scope, { state: 'ERROR' }, 'NUMBER_MISMATCH');
            return;
          }
          try {
            const status = await this.#client.status(scope);
            if (
              this.#store.account(scope).data.desiredState === 'DISCONNECTED' &&
              !['NOT_CREATED', 'DISCONNECTED'].includes(status.state)
            ) {
              const closed = await this.#client.disconnect(scope);
              this.#apply(scope, closed);
              return;
            }
            this.#apply(scope, status);
          } catch (error) {
            if (error.code === 'NUMBER_MISMATCH')
              await this.#client.disconnect(scope).catch(() => {});
            this.#apply(
              scope,
              { state: 'ERROR' },
              codes.has(error.code) ? error.code : 'INSTANCE_UNREACHABLE',
            );
          }
        }),
      ),
    );
  }
}
