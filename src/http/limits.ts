/**
 * How often anyone may do the things that cost us more than they cost them.
 *
 * Paid probes need no limit: each one costs money, which is the limit. What does need one is
 * everything free, which a script could call as fast as it liked, including the free requests that
 * make us read the chain or ask Circle; graded submissions, which `SPEC.md` caps per identity per
 * hour so that brute force is slow whatever it can afford; and payments that fail, which cost us a
 * call to Circle and the sender nothing.
 *
 * Kept in memory. A restart forgets every count, which costs an attacker a restart they cannot cause.
 */

/** Starting runs and reading the harness, per client. Plenty to explore by hand; a hard stop for a script. */
export const FREE_PER_MINUTE = 60;
/** Graded submissions, per paying address. A reasoning agent submits a handful; a brute force hundreds. */
export const GRADED_PER_HOUR = 30;
/**
 * Payments that fail verification, per client. Each costs us a call to Circle and the sender
 * nothing, so a few are a mistake and many are an attack. A payment that works never counts.
 */
export const REFUSED_PER_MINUTE = 10;
/**
 * How long a connection may sit with nothing sent before the server closes it, in seconds.
 *
 * Long enough for every request that only reads the chain to fail properly and say so: at the
 * default of ten, a node that hung got the caller a closed socket where it was owed "try again".
 * The slowest of those is an owner's page, four reads one after another, about thirty-three seconds
 * if every one is waited out. A test starts the server against a node that says nothing and checks
 * the answer still arrives.
 *
 * Not long enough for a write that crawls, and not meant to be. Recording a run and paying out a
 * gig wait for a receipt, which the writers give minutes; past this the caller's connection closes
 * while the write goes on, and both are built to be asked about again without paying twice. Making
 * this long enough for those would hold every idle connection for as long, and the caps above count
 * requests, not connections.
 */
export const IDLE_S = 60;
/**
 * The most steps, one after another, that a request reads the chain in: an owner's page asks which
 * agents a wallet grants to, who holds each former agent's identity, what each agent has earned,
 * and what each is allowed.
 */
export const CHAIN_STEPS = 4;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Past this many keys, buckets that have refilled completely are forgotten; they hold nothing. */
const PRUNE_ABOVE = 10_000;

export type Taken = { readonly ok: true } | { readonly ok: false; readonly retryAfterMs: number };

/**
 * A token bucket per key: `capacity` requests, refilled evenly over `windowMs`.
 *
 * Even refilling rather than a fixed window, so there is no moment at a window's edge where twice
 * the capacity can go through at once.
 */
export class Limiter {
  readonly #buckets = new Map<string, { tokens: number; at: number }>();

  constructor(readonly capacity: number, readonly windowMs: number) {}

  #level(key: string, now: number): number {
    const b = this.#buckets.get(key);
    if (!b) return this.capacity;
    return Math.min(this.capacity, b.tokens + ((now - b.at) * this.capacity) / this.windowMs);
  }

  /** Whether a request would be allowed now, and if not how long until it would, spending nothing. */
  check(key: string, now = Date.now()): Taken {
    const level = this.#level(key, now);
    return level >= 1 ? { ok: true } : { ok: false, retryAfterMs: Math.ceil(((1 - level) * this.windowMs) / this.capacity) };
  }

  allows(key: string, now = Date.now()): boolean { return this.check(key, now).ok; }

  /** Spend one, or say how long until one is there. */
  take(key: string, now = Date.now()): Taken {
    const checked = this.check(key, now);
    if (!checked.ok) return checked;
    const level = this.#level(key, now);
    this.#buckets.set(key, { tokens: level - 1, at: now });
    if (this.#buckets.size > PRUNE_ABOVE) this.#prune(now);
    return { ok: true };
  }

  #prune(now: number): void {
    for (const key of this.#buckets.keys()) {
      if (this.#level(key, now) >= this.capacity) this.#buckets.delete(key);
    }
  }
}

export interface Limits {
  /** Free requests, per client. */
  readonly free: Limiter;
  /** Graded submissions, per paying address, or per client where nobody has paid yet. */
  readonly graded: Limiter;
  /** Payments that failed verification, per client. */
  readonly refused: Limiter;
}

export const defaultLimits = (): Limits => ({
  free: new Limiter(FREE_PER_MINUTE, MINUTE),
  graded: new Limiter(GRADED_PER_HOUR, HOUR),
  refused: new Limiter(REFUSED_PER_MINUTE, MINUTE),
});
