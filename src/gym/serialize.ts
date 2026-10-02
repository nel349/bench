/**
 * One thing at a time, per key.
 *
 * A run is read, a payment is awaited, then the run is mutated and stored. Nothing made that
 * atomic, so two requests for the same run both read the same state, both charged, and the second
 * write erased the first — five concurrent probes were answered against a two-probe budget, the
 * agent was charged five times and the record kept one.
 *
 * That is not a race that costs a little accuracy. The leaderboard ranks by recorded spend, so
 * firing probes in parallel bought every answer and booked a fraction of the cost: a cheat on the
 * only number this product exists to report, and the rational play when the score is the prize.
 *
 * A queue per key is the smallest thing that fixes it. Not a lock — a lock needs releasing on every
 * path including the ones that throw, and the one that is forgotten is the one that deadlocks the
 * server. A promise chain cannot be forgotten: the next task is appended to the last, and `finally`
 * is the only place the queue is cleaned up.
 *
 * This serialises **one process**. Two servers against one database would need the database to do
 * it, and that is a real limit rather than an oversight — it is written down in `FINDINGS.md`.
 */
export class Serial {
  /** The tail of each key's chain. A key is present only while something is queued for it. */
  readonly #tails = new Map<string, Promise<void>>();

  /** Runs `work` after everything already queued for `key`, and never before. */
  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();

    // `then(work, work)` on both paths: a task that throws must not break the chain behind it.
    const result = previous.then(work, work);

    // The tail swallows outcomes, so a rejection never becomes unhandled just by being queued.
    const tail = result.then(() => undefined, () => undefined);
    this.#tails.set(key, tail);

    // Dropped only if nothing else was appended meanwhile, or the map grows for the process's life.
    void tail.then(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    });

    return result;
  }

  /** How many keys are still queued. For tests, and for noticing a leak. */
  get size(): number { return this.#tails.size; }
}
