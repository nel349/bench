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
  id: string; agent: string; problem: string; seed: number;
  started_at: number; ended_at: number | null; outcome: string;
  probes: string; submissions: number; spend: string; budget: string | null; state: string | null;
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
        id TEXT PRIMARY KEY, agent TEXT NOT NULL, problem TEXT NOT NULL, seed INTEGER NOT NULL,
        started_at INTEGER NOT NULL, ended_at INTEGER, outcome TEXT NOT NULL,
        probes TEXT NOT NULL, submissions INTEGER NOT NULL,
        spend TEXT NOT NULL, budget TEXT, state TEXT
      );
      CREATE INDEX IF NOT EXISTS attempts_agent ON attempts(agent);
      CREATE INDEX IF NOT EXISTS attempts_outcome ON attempts(outcome);
      CREATE TABLE IF NOT EXISTS submissions (
        agent TEXT NOT NULL, problem TEXT NOT NULL, n INTEGER NOT NULL,
        PRIMARY KEY (agent, problem)
      );
    `);
  }

  put(a: Attempt): void {
    this.#db.query(`
      INSERT INTO attempts (id, agent, problem, seed, started_at, ended_at, outcome, probes, submissions, spend, budget, state)
      VALUES ($id, $agent, $problem, $seed, $started, $ended, $outcome, $probes, $subs, $spend, $budget, $state)
      ON CONFLICT(id) DO UPDATE SET
        ended_at = $ended, outcome = $outcome, probes = $probes, submissions = $subs, spend = $spend, state = $state
    `).run({
      $id: a.id, $agent: a.agent, $problem: a.problem, $seed: a.seed,
      $started: a.startedAt, $ended: a.endedAt, $outcome: a.outcome,
      $probes: JSON.stringify(a.probes), $subs: a.submissions,
      $spend: a.spend.toString(), $budget: a.budget === null ? null : a.budget.toString(),
      $state: a.state === null || a.state === undefined ? null : JSON.stringify(a.state),
    });
  }

  #hydrate(r: Row): Attempt {
    return {
      id: r.id, agent: r.agent, problem: r.problem, seed: r.seed,
      startedAt: r.started_at, endedAt: r.ended_at, outcome: r.outcome as Attempt["outcome"],
      probes: JSON.parse(r.probes) as { question: unknown; answer: unknown }[],
      submissions: r.submissions, spend: BigInt(r.spend),
      budget: r.budget === null ? null : BigInt(r.budget),
      state: r.state === null ? null : JSON.parse(r.state),
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
