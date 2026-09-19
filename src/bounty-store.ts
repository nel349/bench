import { Database } from "bun:sqlite";
import type { Bounty } from "./bounties.ts";
import { parseCheck } from "./checkers/parse.ts";
import { usdc, format } from "./money.ts";

/**
 * Where bounties live between restarts.
 *
 * A lost leaderboard is embarrassing. A lost bounty is **money stranded on chain**: the escrow still
 * holds the poster's USDC, and the only record of what would win it — the checker — was in a Map.
 * Nobody can ever claim it; it can only sit there until the deadline and be reclaimed. So this is
 * not the same decision as persisting runs, and it is not optional.
 */
export interface BountyStore {
  put(b: Bounty): void;
  get(id: string): Bounty | undefined;
  all(): Bounty[];
  nextId(): string;
}

export class MemoryBounties implements BountyStore {
  readonly #byId = new Map<string, Bounty>();
  #n = 0;
  put(b: Bounty): void { this.#byId.set(b.id, b); }
  get(id: string): Bounty | undefined { return this.#byId.get(id); }
  all(): Bounty[] { return [...this.#byId.values()]; }
  nextId(): string { return `b${++this.#n}`; }
}

interface Row {
  id: string; poster: string; title: string; statement: string; checker: string;
  amount: string; escrow_id: string | null; deadline: number; min_rating: number;
  posted_at: number; solved_by: string | null; solved_at: number | null; attempts: number;
}

export class SqliteBounties implements BountyStore {
  readonly #db: Database;

  constructor(path = "bench.sqlite") {
    this.#db = new Database(path, { create: true });
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS bounties (
        id TEXT PRIMARY KEY, poster TEXT NOT NULL, title TEXT NOT NULL, statement TEXT NOT NULL,
        checker TEXT NOT NULL, amount TEXT NOT NULL, escrow_id TEXT,
        deadline INTEGER NOT NULL, min_rating INTEGER NOT NULL, posted_at INTEGER NOT NULL,
        solved_by TEXT, solved_at INTEGER, attempts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS bounties_open ON bounties(solved_by, deadline);
    `);
  }

  put(b: Bounty): void {
    this.#db.query(`
      INSERT INTO bounties (id, poster, title, statement, checker, amount, escrow_id,
                            deadline, min_rating, posted_at, solved_by, solved_at, attempts)
      VALUES ($id, $poster, $title, $statement, $checker, $amount, $escrow,
              $deadline, $minRating, $postedAt, $solvedBy, $solvedAt, $attempts)
      ON CONFLICT(id) DO UPDATE SET
        solved_by = $solvedBy, solved_at = $solvedAt, attempts = $attempts, escrow_id = $escrow
    `).run({
      $id: b.id, $poster: b.poster, $title: b.title, $statement: b.statement,
      $checker: JSON.stringify(b.checker), $amount: format(b.amount), $escrow: b.escrowId,
      $deadline: b.deadline, $minRating: b.minRating, $postedAt: b.postedAt,
      $solvedBy: b.solvedBy, $solvedAt: b.solvedAt, $attempts: b.attempts,
    });
  }

  /**
   * Rebuilds a bounty, re-validating its checker on the way out.
   *
   * The checker is parsed again rather than trusted, even though this process wrote it. A row can be
   * edited, restored from an old backup, or written by a build where a pattern was still allowed —
   * and a checker that fails validation must be caught here, where it is one broken bounty, rather
   * than inside `run` while somebody's paid submission is being graded.
   */
  #hydrate(r: Row): Bounty | undefined {
    const parsed = parseCheck(JSON.parse(r.checker));
    if (!parsed.ok) {
      console.error(`[bench] bounty ${r.id} has an unusable checker (${parsed.problem}); skipping it`);
      return undefined;
    }
    return {
      id: r.id, poster: r.poster, title: r.title, statement: r.statement, checker: parsed.check,
      amount: usdc(r.amount), escrowId: r.escrow_id, deadline: r.deadline,
      minRating: r.min_rating, postedAt: r.posted_at,
      solvedBy: r.solved_by, solvedAt: r.solved_at, attempts: r.attempts,
    };
  }

  get(id: string): Bounty | undefined {
    const r = this.#db.query<Row, [string]>("SELECT * FROM bounties WHERE id = ?").get(id);
    return r ? this.#hydrate(r) : undefined;
  }

  all(): Bounty[] {
    return this.#db.query<Row, []>("SELECT * FROM bounties ORDER BY posted_at DESC")
      .all().map((r) => this.#hydrate(r)).filter((b): b is Bounty => b !== undefined);
  }

  /**
   * The next id, taken from the table rather than a counter.
   *
   * A counter in memory restarts at zero, and the second `b1` would overwrite the first — taking a
   * live bounty's checker with it. Derived from what is stored, it cannot.
   */
  nextId(): string {
    const r = this.#db.query<{ n: number }, []>(
      "SELECT COALESCE(MAX(CAST(SUBSTR(id, 2) AS INTEGER)), 0) AS n FROM bounties",
    ).get();
    return `b${(r?.n ?? 0) + 1}`;
  }
}
