import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { constants, openSync, closeSync, lstatSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { instanceScope } from './instance-client.mjs';

export class StoreError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
const recordKinds = new Set(['event', 'command']);
function canonical(value, depth = 0) {
  if (depth > 20) throw new StoreError('STORAGE_PAYLOAD_LIMIT');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => canonical(item, depth + 1));
  if (
    value &&
    typeof value === 'object' &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    const result = Object.create(null);
    for (const key of Object.keys(value).sort()) result[key] = canonical(value[key], depth + 1);
    return result;
  }
  throw new StoreError('STORAGE_PAYLOAD_INVALID');
}
function json(value, limit = 262144) {
  const text = JSON.stringify(canonical(value));
  if (Buffer.byteLength(text) > limit) throw new StoreError('STORAGE_PAYLOAD_LIMIT');
  return text;
}
function scoped(input) {
  const { name, ...scope } = instanceScope(input);
  return {
    scope,
    name,
    owner: hash(JSON.stringify(['monzo-evolution-account-v1', scope.tenantId, scope.accountId])),
  };
}
function recordId(kind, owner, generation, key) {
  if (!recordKinds.has(kind) || typeof key !== 'string' || !/^[a-zA-Z0-9:_-]{1,192}$/.test(key))
    throw new StoreError('STORAGE_RECORD_INVALID');
  // A command key cannot be reused after reconnecting: the old attempt may have sent.
  return hash(JSON.stringify([kind, owner, kind === 'event' ? generation : null, key]));
}

export class DurableStore {
  #db;
  #key;
  #bindingKey;
  #clock;
  #capacity;
  #transaction = false;
  #transactionFailed = false;
  #closed = false;
  constructor({ directory, key, clock = Date.now, capacity = 50000, maxPages = 65536 }) {
    if (
      !/^[a-f0-9]{64}$/.test(key ?? '') ||
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      capacity > 100000 ||
      !Number.isInteger(maxPages) ||
      maxPages < 1024 ||
      maxPages > 262144
    )
      throw new StoreError('STORAGE_CONFIGURATION');
    this.#clock = clock;
    this.#capacity = capacity;
    const master = Buffer.from(key, 'hex');
    this.#key = createHmac('sha256', master)
      .update('monzo-evolution-storage-encryption-v1')
      .digest();
    this.#bindingKey = createHmac('sha256', master)
      .update('monzo-evolution-storage-binding-v1')
      .digest();
    master.fill(0);
    const folder = resolve(directory);
    try {
      mkdirSync(folder, { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw new StoreError('STORAGE_DIRECTORY');
    }
    const stat = lstatSync(folder);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid() ||
      (stat.mode & 0o077) !== 0
    )
      throw new StoreError('STORAGE_DIRECTORY');
    const filename = resolve(folder, 'gateway.sqlite');
    try {
      const fd = openSync(
        filename,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      closeSync(fd);
    } catch (error) {
      if (error.code !== 'EEXIST') throw new StoreError('STORAGE_FILE');
    }
    const file = lstatSync(filename);
    if (
      !file.isFile() ||
      file.isSymbolicLink() ||
      file.uid !== process.getuid() ||
      (file.mode & 0o077) !== 0
    )
      throw new StoreError('STORAGE_FILE');
    try {
      this.#db = new DatabaseSync(filename, {
        enableForeignKeyConstraints: true,
        allowExtension: false,
      });
      this.#db.exec('PRAGMA busy_timeout=2000;');
      const version = this.#db.prepare('PRAGMA user_version').get().user_version;
      if (version !== 0 && version !== 1) throw new StoreError('STORAGE_VERSION');
      if (version === 0) {
        if (
          this.#db
            .prepare(
              "SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            )
            .get().count !== 0
        )
          throw new StoreError('STORAGE_VERSION');
        this.#db.exec(`BEGIN IMMEDIATE;
          CREATE TABLE meta(key TEXT PRIMARY KEY,value BLOB NOT NULL);
          CREATE TABLE accounts(owner TEXT PRIMARY KEY,generation INTEGER NOT NULL,instance TEXT NOT NULL UNIQUE,payload BLOB NOT NULL,updated_at INTEGER NOT NULL);
          CREATE TABLE journal(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,owner TEXT NOT NULL,generation INTEGER NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('event','command')),state TEXT NOT NULL CHECK(state IN ('PENDING','PROCESSING','DONE','UNKNOWN')),
            digest TEXT NOT NULL,payload BLOB NOT NULL,result BLOB,lease_token TEXT,lease_until INTEGER,available_at INTEGER NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,notified INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
            FOREIGN KEY(owner) REFERENCES accounts(owner));
          CREATE INDEX journal_dispatch ON journal(kind,state,available_at,seq);
          CREATE INDEX journal_owner ON journal(owner,kind,state,seq);
          CREATE TABLE blobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,generation INTEGER NOT NULL,digest TEXT NOT NULL,payload BLOB NOT NULL,created_at INTEGER NOT NULL,
            FOREIGN KEY(owner) REFERENCES accounts(owner));
          PRAGMA user_version=1;`);
        this.#db
          .prepare('INSERT INTO meta(key,value) VALUES (?,?)')
          .run('key-check', this.#seal('meta', 'key-check', 'monzo-evolution-storage-v1'));
        this.#db.exec('COMMIT;');
      }
      const check = this.#db.prepare('SELECT value FROM meta WHERE key=?').get('key-check');
      if (!check || this.#open('meta', 'key-check', check.value) !== 'monzo-evolution-storage-v1')
        throw new StoreError('STORAGE_KEY_INVALID');
      // Keep the SQLite lock for the lifetime of the spool: only one gateway dispatches it.
      this.#db.exec(
        `PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=256; PRAGMA cache_size=-4096; PRAGMA max_page_count=${maxPages};`,
      );
      this.atomic(() => {
        const interrupted = this.#db
          .prepare("SELECT * FROM journal WHERE kind='command' AND state='PROCESSING'")
          .all();
        for (const row of interrupted)
          this.#db
            .prepare(
              "UPDATE journal SET state='UNKNOWN',result=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?",
            )
            .run(
              this.#seal('result', row.id, { code: 'PROCESS_INTERRUPTED', state: 'UNKNOWN' }),
              this.#clock(),
              row.id,
            );
        this.#db
          .prepare(
            "UPDATE journal SET state='PENDING',lease_token=NULL,lease_until=NULL WHERE kind='event' AND state='PROCESSING'",
          )
          .run();
      });
    } catch (error) {
      try {
        this.#db?.close();
      } catch {}
      this.#key.fill(0);
      this.#bindingKey.fill(0);
      throw error instanceof StoreError ? error : new StoreError('STORAGE_UNAVAILABLE');
    }
  }
  #seal(kind, id, value) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, nonce);
    cipher.setAAD(Buffer.from(`monzo-evolution-store-v1:${kind}:${id}`));
    const bytes = Buffer.from(JSON.stringify(value));
    return this.#encrypt(cipher, nonce, bytes);
  }
  #encrypt(cipher, nonce, bytes) {
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), encrypted]);
  }
  #open(kind, id, value) {
    try {
      const bytes = Buffer.from(value);
      if (bytes.length < 30 || bytes[0] !== 1) throw new Error('format');
      const decipher = createDecipheriv('aes-256-gcm', this.#key, bytes.subarray(1, 13));
      decipher.setAAD(Buffer.from(`monzo-evolution-store-v1:${kind}:${id}`));
      decipher.setAuthTag(bytes.subarray(13, 29));
      return JSON.parse(
        Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()]).toString('utf8'),
      );
    } catch {
      throw new StoreError('STORAGE_DATA_INVALID');
    }
  }
  #digest(value) {
    return createHmac('sha256', this.#bindingKey).update(value).digest('hex');
  }
  atomic(work) {
    if (this.#closed) throw new StoreError('STORAGE_CLOSED');
    if (typeof work !== 'function' || work.constructor.name === 'AsyncFunction') {
      if (this.#transaction) this.#transactionFailed = true;
      throw new StoreError('STORAGE_ASYNC_TRANSACTION');
    }
    if (this.#transaction) {
      try {
        const result = work();
        if (result && typeof result.then === 'function')
          throw new StoreError('STORAGE_ASYNC_TRANSACTION');
        return result;
      } catch (error) {
        this.#transactionFailed = true;
        throw error;
      }
    }
    try {
      this.#db.exec('BEGIN IMMEDIATE');
      this.#transaction = true;
      this.#transactionFailed = false;
      const result = work();
      if (result && typeof result.then === 'function')
        throw new StoreError('STORAGE_ASYNC_TRANSACTION');
      if (this.#transactionFailed) throw new StoreError('STORAGE_TRANSACTION_ABORTED');
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.#db.exec('ROLLBACK');
      } catch {}
      if (error instanceof StoreError) throw error;
      throw new StoreError(
        [5, 6].includes(error.errcode)
          ? 'STORAGE_BUSY'
          : error.errcode === 13
            ? 'STORAGE_FULL'
            : 'STORAGE_UNAVAILABLE',
      );
    } finally {
      this.#transaction = false;
      this.#transactionFailed = false;
    }
  }
  #account(row) {
    if (!row) return null;
    const record = this.#open('account', row.owner, row.payload);
    try {
      const expected = scoped(record.scope);
      if (
        expected.owner !== row.owner ||
        expected.name !== row.instance ||
        record.name !== row.instance ||
        expected.scope.generation !== row.generation
      )
        throw new Error('scope');
    } catch {
      throw new StoreError('STORAGE_DATA_INVALID');
    }
    return record;
  }
  register(input, data = {}) {
    const { scope, name, owner } = scoped(input);
    json(data);
    return this.atomic(() => {
      const previous = this.#account(
        this.#db.prepare('SELECT * FROM accounts WHERE owner=?').get(owner),
      );
      if (previous) {
        if (previous.scope.expectedPhone !== scope.expectedPhone)
          throw new StoreError('NUMBER_SCOPE_CHANGED');
        if (previous.scope.generation > scope.generation) throw new StoreError('STALE_GENERATION');
        if (previous.scope.generation === scope.generation) return previous;
      }
      const stale = this.#db
        .prepare(
          "SELECT * FROM journal WHERE owner=? AND generation<? AND kind='command' AND state='PENDING'",
        )
        .all(owner, scope.generation);
      for (const row of stale)
        this.#db
          .prepare("UPDATE journal SET state='DONE',result=?,updated_at=? WHERE id=?")
          .run(
            this.#seal('result', row.id, { state: 'CANCELED', code: 'GENERATION_CHANGED' }),
            this.#clock(),
            row.id,
          );
      const record = { scope, name, data };
      this.#db
        .prepare(
          'INSERT INTO accounts(owner,generation,instance,payload,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET generation=excluded.generation,instance=excluded.instance,payload=excluded.payload,updated_at=excluded.updated_at',
        )
        .run(owner, scope.generation, name, this.#seal('account', owner, record), this.#clock());
      return record;
    });
  }
  account(input) {
    const { scope, owner } = scoped(input);
    const record = this.#account(
      this.#db.prepare('SELECT * FROM accounts WHERE owner=?').get(owner),
    );
    if (
      !record ||
      record.scope.generation !== scope.generation ||
      record.scope.expectedPhone !== scope.expectedPhone
    )
      throw new StoreError('STALE_GENERATION');
    return record;
  }
  byInstance(name) {
    if (typeof name !== 'string' || !/^monzo_[a-f0-9]{48}_[1-9][0-9]{0,9}$/.test(name)) return null;
    return this.#account(this.#db.prepare('SELECT * FROM accounts WHERE instance=?').get(name));
  }
  accounts() {
    return this.#db
      .prepare('SELECT * FROM accounts ORDER BY owner LIMIT 1000')
      .all()
      .map((row) => this.#account(row));
  }
  updateAccount(input, data) {
    json(data);
    const { scope, owner } = scoped(input);
    return this.atomic(() => {
      const current = this.account(scope);
      const record = { ...current, data };
      this.#db
        .prepare('UPDATE accounts SET payload=?,updated_at=? WHERE owner=? AND generation=?')
        .run(this.#seal('account', owner, record), this.#clock(), owner, scope.generation);
      return record;
    });
  }
  #journal(row) {
    if (!row) return null;
    const envelope = this.#open('journal', row.id, row.payload);
    try {
      const expected = scoped(envelope.scope);
      if (
        expected.owner !== row.owner ||
        expected.scope.generation !== row.generation ||
        recordId(row.kind, expected.owner, expected.scope.generation, envelope.key) !== row.id
      )
        throw new Error('scope');
    } catch {
      throw new StoreError('STORAGE_DATA_INVALID');
    }
    return {
      id: row.id,
      sequence: row.seq,
      kind: row.kind,
      state: row.state,
      attempts: row.attempts,
      notified: Boolean(row.notified),
      leaseToken: row.lease_token,
      leaseUntil: row.lease_until,
      availableAt: row.available_at,
      createdAt: row.created_at,
      ...envelope,
      result: row.result ? this.#open('result', row.id, row.result) : null,
    };
  }
  enqueue(input, kind, key, payload) {
    const { scope, owner } = scoped(input);
    const id = recordId(kind, owner, scope.generation, key);
    const digest = this.#digest(json(payload));
    return this.atomic(() => {
      const account = this.#account(
        this.#db.prepare('SELECT * FROM accounts WHERE owner=?').get(owner),
      );
      if (
        !account ||
        account.scope.generation < scope.generation ||
        (kind === 'command' && account.scope.generation !== scope.generation) ||
        account.scope.expectedPhone !== scope.expectedPhone
      )
        throw new StoreError('STALE_GENERATION');
      const previous = this.#db.prepare('SELECT * FROM journal WHERE id=?').get(id);
      if (previous) {
        if (previous.digest !== digest || previous.generation !== scope.generation)
          throw new StoreError('IDEMPOTENCY_CONFLICT');
        return this.#journal(previous);
      }
      if (this.#db.prepare('SELECT count(*) AS count FROM journal').get().count >= this.#capacity)
        throw new StoreError('STORAGE_FULL');
      const now = this.#clock();
      this.#db
        .prepare(
          "INSERT INTO journal(id,owner,generation,kind,state,digest,payload,available_at,created_at,updated_at) VALUES (?,?,?,?,'PENDING',?,?,?,?,?)",
        )
        .run(
          id,
          owner,
          scope.generation,
          kind,
          digest,
          this.#seal('journal', id, { scope, key, payload }),
          now,
          now,
          now,
        );
      return this.#journal(this.#db.prepare('SELECT * FROM journal WHERE id=?').get(id));
    });
  }
  record(input, kind, key) {
    const { scope, owner } = scoped(input);
    return this.#journal(
      this.#db
        .prepare('SELECT * FROM journal WHERE id=?')
        .get(recordId(kind, owner, scope.generation, key)),
    );
  }
  claim(kind, { limit = 10, leaseMs = 30000 } = {}) {
    if (
      !recordKinds.has(kind) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(leaseMs) ||
      leaseMs < 1000 ||
      leaseMs > 120000
    )
      throw new StoreError('STORAGE_CLAIM_INVALID');
    return this.atomic(() => {
      const now = this.#clock();
      if (kind === 'command') {
        const expired = this.#db
          .prepare(
            "SELECT * FROM journal WHERE kind='command' AND state='PROCESSING' AND lease_until<=? ORDER BY seq LIMIT 100",
          )
          .all(now);
        for (const row of expired)
          this.#db
            .prepare(
              "UPDATE journal SET state='UNKNOWN',result=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?",
            )
            .run(
              this.#seal('result', row.id, { code: 'PROCESS_INTERRUPTED', state: 'UNKNOWN' }),
              now,
              row.id,
            );
      }
      const rows =
        kind === 'event'
          ? this.#db
              .prepare(
                `SELECT j.* FROM journal j WHERE j.kind='event' AND j.available_at<=? AND (j.state='PENDING' OR (j.state='PROCESSING' AND j.lease_until<=?))
          AND NOT EXISTS(SELECT 1 FROM journal older WHERE older.kind='event' AND older.owner=j.owner AND older.seq<j.seq AND older.state IN ('PENDING','PROCESSING')) ORDER BY j.seq LIMIT ?`,
              )
              .all(now, now, limit)
          : this.#db
              .prepare(
                "SELECT * FROM journal WHERE kind='command' AND state='PENDING' AND available_at<=? ORDER BY seq LIMIT ?",
              )
              .all(now, limit);
      return rows.map((row) => {
        const token = randomBytes(16).toString('hex');
        this.#db
          .prepare(
            "UPDATE journal SET state='PROCESSING',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=?",
          )
          .run(token, now + leaseMs, now, row.id);
        return this.#journal(this.#db.prepare('SELECT * FROM journal WHERE id=?').get(row.id));
      });
    });
  }
  finish(id, leaseToken, result) {
    json(result, 65536);
    return this.atomic(() => {
      const row = this.#db
        .prepare("SELECT * FROM journal WHERE id=? AND state='PROCESSING' AND lease_token=?")
        .get(id, leaseToken);
      if (!row) return false;
      const envelope = this.#open('journal', id, row.payload);
      if (row.kind === 'event') envelope.payload = {};
      return (
        this.#db
          .prepare(
            "UPDATE journal SET state='DONE',payload=?,result=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=?",
          )
          .run(
            this.#seal('journal', id, envelope),
            this.#seal('result', id, result),
            this.#clock(),
            id,
            leaseToken,
          ).changes === 1
      );
    });
  }
  retryEvent(id, leaseToken, delayMs) {
    if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 3600000)
      throw new StoreError('STORAGE_RETRY_INVALID');
    return this.atomic(
      () =>
        this.#db
          .prepare(
            "UPDATE journal SET state='PENDING',lease_token=NULL,lease_until=NULL,available_at=?,updated_at=? WHERE id=? AND kind='event' AND state='PROCESSING' AND lease_token=?",
          )
          .run(this.#clock() + delayMs, this.#clock(), id, leaseToken).changes === 1,
    );
  }
  pendingResults(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new StoreError('STORAGE_CLAIM_INVALID');
    return this.#db
      .prepare(
        "SELECT * FROM journal WHERE kind='command' AND state IN ('DONE','UNKNOWN') AND notified=0 ORDER BY seq LIMIT ?",
      )
      .all(limit)
      .map((row) => this.#journal(row));
  }
  markNotified(id) {
    return this.atomic(
      () =>
        this.#db
          .prepare(
            "UPDATE journal SET notified=1 WHERE id=? AND kind='command' AND state IN ('DONE','UNKNOWN') AND notified=0",
          )
          .run(id).changes === 1,
    );
  }
  cleanup(retainMs = 7 * 86400000) {
    if (!Number.isInteger(retainMs) || retainMs < 60000)
      throw new StoreError('STORAGE_RETENTION_INVALID');
    return this.atomic(() => {
      const before = this.#clock() - retainMs;
      const deleted = this.#db
        .prepare("DELETE FROM journal WHERE kind='event' AND state='DONE' AND updated_at<?")
        .run(before).changes;
      const commands = this.#db
        .prepare(
          "SELECT * FROM journal WHERE kind='command' AND state IN ('DONE','UNKNOWN') AND notified=1 AND updated_at<? ORDER BY seq LIMIT 100",
        )
        .all(before);
      for (const row of commands) {
        const envelope = this.#open('journal', row.id, row.payload);
        envelope.payload = {};
        this.#db
          .prepare('UPDATE journal SET payload=? WHERE id=?')
          .run(this.#seal('journal', row.id, envelope), row.id);
      }
      return deleted;
    });
  }
  stats() {
    return this.#db
      .prepare(
        'SELECT kind,state,count(*) AS count FROM journal GROUP BY kind,state ORDER BY kind,state',
      )
      .all();
  }
  close() {
    if (this.#closed) return;
    this.#db.close();
    this.#closed = true;
    this.#key.fill(0);
    this.#bindingKey.fill(0);
  }
}
