import { createPolicyError, POLICY_ERROR_REASON } from "./errors.js";

const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 1000;

const ENTRY_STATE = {
  PENDING: "pending",
  COMPLETED: "completed",
} as const;

export const IDEMPOTENCY_STATUS = {
  ABSENT: "absent",
  RESERVED: "reserved",
  REPLAY: "replay",
} as const;

interface PendingEntry {
  readonly state: typeof ENTRY_STATE.PENDING;
  readonly fingerprint: string;
  readonly token: symbol;
  readonly sequence: number;
}

interface CompletedEntry<T> {
  readonly state: typeof ENTRY_STATE.COMPLETED;
  readonly fingerprint: string;
  readonly result: T;
  readonly completedAt: number;
  readonly expiresAt: number;
  readonly sequence: number;
}

type Entry<T> = PendingEntry | CompletedEntry<T>;

export type Reservation<T> =
  | { readonly status: typeof IDEMPOTENCY_STATUS.RESERVED; readonly token: symbol }
  | { readonly status: typeof IDEMPOTENCY_STATUS.REPLAY; readonly result: T };

export type IdempotencyLookup<T> =
  | { readonly status: typeof IDEMPOTENCY_STATUS.ABSENT }
  | { readonly status: typeof IDEMPOTENCY_STATUS.REPLAY; readonly result: T };

export interface IdempotencyStore<T> {
  lookup(tool: string, key: string, fingerprint: string): IdempotencyLookup<T>;
  reserve(tool: string, key: string, fingerprint: string): Reservation<T>;
  complete(tool: string, key: string, fingerprint: string, token: symbol, result: T): void;
  release(tool: string, key: string, fingerprint: string, token: symbol): void;
}

export interface IdempotencyRegistry {
  forTool<T>(tool: string): IdempotencyStore<T>;
}

function namespace(tool: string, key: string): string {
  return `${tool.length}:${tool}${key}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryIdempotencyStore<T> implements IdempotencyStore<T> {
  readonly #entries = new Map<string, Entry<T>>();
  readonly #now: () => number;
  #sequence = 0;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  get size(): number {
    this.#evictExpired();
    return this.#entries.size;
  }

  lookup(tool: string, key: string, fingerprint: string): IdempotencyLookup<T> {
    this.#evictExpired();
    const existing = this.#entries.get(namespace(tool, key));
    if (existing === undefined) return { status: IDEMPOTENCY_STATUS.ABSENT };
    if (existing.fingerprint !== fingerprint) {
      throw createPolicyError(POLICY_ERROR_REASON.IDEMPOTENCY_CONFLICT);
    }
    if (existing.state === ENTRY_STATE.PENDING) {
      throw createPolicyError(POLICY_ERROR_REASON.IDEMPOTENCY_PENDING);
    }
    return { status: IDEMPOTENCY_STATUS.REPLAY, result: clone(existing.result) };
  }

  reserve(tool: string, key: string, fingerprint: string): Reservation<T> {
    this.#evictExpired();
    const entryKey = namespace(tool, key);
    const existing = this.#entries.get(entryKey);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        throw createPolicyError(POLICY_ERROR_REASON.IDEMPOTENCY_CONFLICT);
      }
      if (existing.state === ENTRY_STATE.PENDING) {
        throw createPolicyError(POLICY_ERROR_REASON.IDEMPOTENCY_PENDING);
      }
      return { status: IDEMPOTENCY_STATUS.REPLAY, result: clone(existing.result) };
    }

    this.#makeCapacity();
    const token = Symbol("idempotency-reservation");
    this.#entries.set(entryKey, {
      state: ENTRY_STATE.PENDING,
      fingerprint,
      token,
      sequence: this.#sequence++,
    });
    return { status: IDEMPOTENCY_STATUS.RESERVED, token };
  }

  complete(tool: string, key: string, fingerprint: string, token: symbol, result: T): void {
    this.#evictExpired();
    const entryKey = namespace(tool, key);
    const existing = this.#entries.get(entryKey);
    if (
      existing?.state !== ENTRY_STATE.PENDING ||
      existing.fingerprint !== fingerprint ||
      existing.token !== token
    ) {
      throw createPolicyError(POLICY_ERROR_REASON.IDEMPOTENCY_RESERVATION);
    }
    const completedAt = this.#now();
    this.#entries.set(entryKey, {
      state: ENTRY_STATE.COMPLETED,
      fingerprint,
      result: clone(result),
      completedAt,
      expiresAt: completedAt + RETENTION_MS,
      sequence: existing.sequence,
    });
  }

  release(tool: string, key: string, fingerprint: string, token: symbol): void {
    this.#evictExpired();
    const entryKey = namespace(tool, key);
    const existing = this.#entries.get(entryKey);
    if (
      existing?.state === ENTRY_STATE.PENDING &&
      existing.fingerprint === fingerprint &&
      existing.token === token
    ) {
      this.#entries.delete(entryKey);
    }
  }

  #evictExpired(): void {
    const now = this.#now();
    for (const [key, entry] of this.#entries) {
      if (entry.state === ENTRY_STATE.COMPLETED && entry.expiresAt <= now) {
        this.#entries.delete(key);
      }
    }
  }

  #makeCapacity(): void {
    if (this.#entries.size < MAX_ENTRIES) return;
    let candidate: [string, CompletedEntry<T>] | undefined;
    for (const pair of this.#entries) {
      const entry = pair[1];
      if (entry.state !== ENTRY_STATE.COMPLETED) continue;
      if (
        candidate === undefined ||
        entry.completedAt < candidate[1].completedAt ||
        (entry.completedAt === candidate[1].completedAt && entry.sequence < candidate[1].sequence)
      ) {
        candidate = [pair[0], entry];
      }
    }
    if (candidate === undefined) {
      throw createPolicyError(POLICY_ERROR_REASON.IDEMPOTENCY_CAPACITY);
    }
    this.#entries.delete(candidate[0]);
  }
}

export class InMemoryIdempotencyRegistry implements IdempotencyRegistry {
  readonly #stores = new Map<string, InMemoryIdempotencyStore<unknown>>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  forTool<T>(tool: string): IdempotencyStore<T> {
    const existing = this.#stores.get(tool);
    if (existing !== undefined) {
      // Each public tool name owns one result schema, so a name always resolves
      // to the same concrete store type for the life of this registry.
      return existing as IdempotencyStore<T>;
    }
    const created = new InMemoryIdempotencyStore<unknown>(this.#now);
    this.#stores.set(tool, created);
    return created as IdempotencyStore<T>;
  }
}
