import { Database } from "bun:sqlite";
import type { Attempt } from "./attempt.ts";
import type { AgentId } from "./payments.ts";

/**
 * Where runs live between restarts.
 *
 * Until now everything was in a Map, which is fine for proving a flow and useless for running one:
 * a deploy would forget every run and every rating the moment it restarted, and a leaderboard that
 * resets is not a leaderboard. So the attempts move behind a store, and the in-memory one stays for
 * tests — same semantics, no file, no cleanup.
 *
 * Money is stored as the decimal string it is formatted as, never as a float. SQLite has no bigint
 * and its REAL would round; a string round-trips exactly and sorts correctly when zero-padded, which
 * is what `format` already produces.
 */
export interface Store {
  put(a: Attempt): void;
  get(id: string): Attempt | undefined;
  all(): Attempt[];
  /** Graded submissions this agent has made on this problem, which decides the price of the next. */
  priorSubmissions(agent: AgentId, problem: string): number;
  noteSubmission(agent: AgentId, problem: string): void;
  nextId(): string;
}

export class MemoryStore implements Store {
  readonly #byId = new Map<string, Attempt>();
  readonly #prior = new Map<string, number>();
  #n = 0;

  put(a: Attempt): void { this.#byId.set(a.id, a); }
  get(id: string): Attempt | undefined { return this.#byId.get(id); }
  all(): Attempt[] { return [...this.#byId.values()]; }
  priorSubmissions(agent: AgentId, problem: string): number { return this.#prior.get(`${agent}:${problem}`) ?? 0; }
  noteSubmission(agent: AgentId, problem: string): void {
    const k = `${agent}:${problem}`;
    this.#prior.set(k, (this.#prior.get(k) ?? 0) + 1);
  }
  nextId(): string { return `a${++this.#n}`; }
}

interface Row {
  id: string; agent: string; problem: string; seed: string | number; payer: string | null; claimed_id: string | null; identity: string | null;
  started_at: number; ended_at: number | null; outcome: string;
  probes: string; submissions: number; spend: string; budget: string | null; state: string | null;
  rank_paid: number | null; rank_tx: string | null;
}

/**
 * SQLite, which Bun ships, so persistence costs no dependency and no service.
 *
 * One file. A gym that needs a database cluster before its first user is a gym that never gets one.
 */
export class SqliteStore implements Store {
  readonly #db: Database;

  constructor(path = process.env["BENCH_DB"] ?? "bench.sqlite") {
    this.#db = new Database(path, { create: true });
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY, agent TEXT NOT NULL, problem TEXT NOT NULL, seed TEXT NOT NULL,
        payer TEXT, claimed_id TEXT, identity TEXT,
        started_at INTEGER NOT NULL, ended_at INTEGER, outcome TEXT NOT NULL,
        probes TEXT NOT NULL, submissions INTEGER NOT NULL,
        spend TEXT NOT NULL, budget TEXT, state TEXT, rank_paid INTEGER, rank_tx TEXT
      );
      CREATE INDEX IF NOT EXISTS attempts_agent ON attempts(agent);
      CREATE INDEX IF NOT EXISTS attempts_outcome ON attempts(outcome);
      CREATE TABLE IF NOT EXISTS submissions (
        agent TEXT NOT NULL, problem TEXT NOT NULL, n INTEGER NOT NULL,
        PRIMARY KEY (agent, problem)
      );
    `);
    this.#migrate();
  }

  /**
   * Columns added after the first release.
   *
   * `CREATE TABLE IF NOT EXISTS` is a no-op on a database that already has the table, so a new
   * column never reaches one — and the failure lands on the first write, in production, not here.
   * Adding it is idempotent and cheap, so it is checked on every open rather than tracked in a
   * version table that would be one more thing to keep honest.
   */
  #migrate(): void {
    const cols = this.#db.query<{ name: string }, []>("PRAGMA table_info(attempts)").all();
    const has = new Set(cols.map((c) => c.name));
    for (const col of ["payer", "claimed_id", "identity", "rank_tx"]) {
      if (!has.has(col)) this.#db.exec(`ALTER TABLE attempts ADD COLUMN ${col} TEXT`);
    }
    if (!has.has("rank_paid")) this.#db.exec("ALTER TABLE attempts ADD COLUMN rank_paid INTEGER");
  }

  put(a: Attempt): void {
    this.#db.query(`
      INSERT INTO attempts (id, agent, problem, seed, payer, claimed_id, identity, started_at, ended_at, outcome, probes, submissions, spend, budget, state, rank_paid, rank_tx)
      VALUES ($id, $agent, $problem, $seed, $payer, $claimed, $identity, $started, $ended, $outcome, $probes, $subs, $spend, $budget, $state, $rankPaid, $rankTx)
      ON CONFLICT(id) DO UPDATE SET
        ended_at = $ended, outcome = $outcome, probes = $probes, submissions = $subs,
        spend = $spend, state = $state, payer = $payer, identity = $identity,
        rank_paid = $rankPaid, rank_tx = $rankTx
    `).run({
      $id: a.id, $agent: a.agent, $problem: a.problem, $seed: a.seed, $payer: a.payer, $claimed: a.claimedId, $identity: a.identity,
      $started: a.startedAt, $ended: a.endedAt, $outcome: a.outcome,
      $probes: JSON.stringify(a.probes), $subs: a.submissions,
      $spend: a.spend.toString(), $budget: a.budget === null ? null : a.budget.toString(),
      $state: a.state === null || a.state === undefined ? null : JSON.stringify(a.state),
      $rankPaid: a.rank ? 1 : 0, $rankTx: a.rank?.tx ?? null,
    });
  }

  #hydrate(r: Row): Attempt {
    return {
      id: r.id, agent: r.agent, problem: r.problem,
      // A database made before seeds were text declared the column INTEGER, and SQLite hands back
      // what it holds. Those numeric seeds were played under the old generator: see `seed.ts`.
      seed: String(r.seed), payer: r.payer,
      claimedId: r.claimed_id, identity: r.identity,
      startedAt: r.started_at, endedAt: r.ended_at, outcome: r.outcome as Attempt["outcome"],
      probes: JSON.parse(r.probes) as { question: unknown; answer: unknown }[],
      submissions: r.submissions, spend: BigInt(r.spend),
      budget: r.budget === null ? null : BigInt(r.budget),
      state: r.state === null ? null : JSON.parse(r.state),
      rank: r.rank_paid ? { tx: r.rank_tx } : null,
    };
  }

  get(id: string): Attempt | undefined {
    const r = this.#db.query<Row, [string]>("SELECT * FROM attempts WHERE id = ?").get(id);
    return r ? this.#hydrate(r) : undefined;
  }

  all(): Attempt[] {
    return this.#db.query<Row, []>("SELECT * FROM attempts ORDER BY started_at").all().map((r) => this.#hydrate(r));
  }

  priorSubmissions(agent: AgentId, problem: string): number {
    const r = this.#db.query<{ n: number }, [string, string]>(
      "SELECT n FROM submissions WHERE agent = ? AND problem = ?").get(agent, problem);
    return r?.n ?? 0;
  }

  noteSubmission(agent: AgentId, problem: string): void {
    this.#db.query(`
      INSERT INTO submissions (agent, problem, n) VALUES (?, ?, 1)
      ON CONFLICT(agent, problem) DO UPDATE SET n = n + 1
    `).run(agent, problem);
  }

  nextId(): string {
    const r = this.#db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM attempts").get();
    return `a${(r?.n ?? 0) + 1}`;
  }

  close(): void { this.#db.close(); }
}
