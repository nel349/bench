import { expect, test, describe, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, SqliteStore, type Store } from "./store.ts";
import { Attempts, score } from "./attempt.ts";
import { InMemoryAllowance } from "./payments.ts";
import { usdc, format } from "./money.ts";
import { boardFrom } from "./problems/blackbox.ts";
import "./problems/blackbox-problem.ts";

const AGENT = "agent:aria";
const SEED = "4242";
const dirs: string[] = [];

function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), "bench-"));
  dirs.push(d);
  return join(d, "test.sqlite");
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/**
 * The same run, against each store.
 *
 * A Map hands back the object you put in; SQLite hands back a copy rebuilt from columns. Code that
 * works against one and not the other fails only where the store is real, so both are held to the
 * same behaviour here rather than the file one being trusted because the Map one passed.
 */
const stores: [string, () => Store][] = [
  ["memory", () => new MemoryStore()],
  ["sqlite", () => new SqliteStore(scratch())],
];

for (const [name, make] of stores) {
  describe(`a full run, on ${name}`, () => {
    test("probes, a wrong guess and a solve all survive the round trip", async () => {
      const money = new InMemoryAllowance();
      money.grant(AGENT, usdc("5"));
      const attempts = new Attempts(money, make());

      const a = attempts.start(AGENT, "blackbox", SEED)!;
      await attempts.ask(a.id, { side: "left", index: 0 });
      await attempts.ask(a.id, { side: "up", index: 3 });
      await attempts.submit(a.id, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]);
      await attempts.submit(a.id, boardFrom(SEED).atoms);

      const s = score(attempts.get(a.id)!);
      expect(s.solved).toBe(true);
      expect(s.probes).toBe(2);
      expect(s.submissions).toBe(2);
      expect(format(s.spend)).toBe("0.090000");   // two probes, a free first guess, then $0.05
    });

    test("the first submission on a problem is free exactly once per agent", async () => {
      const money = new InMemoryAllowance();
      money.grant(AGENT, usdc("5"));
      const attempts = new Attempts(money, make());
      const wrong = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];

      const first = attempts.start(AGENT, "blackbox", SEED)!;
      await attempts.submit(first.id, wrong);

      // A second attempt by the same agent at the same problem: no longer free.
      const second = attempts.start(AGENT, "blackbox", "99")!;
      await attempts.submit(second.id, wrong);
      expect(format(attempts.get(second.id)!.spend)).toBe("0.050000");
    });

    test("a refusal is stored, not just returned", async () => {
      const money = new InMemoryAllowance();
      money.grant(AGENT, usdc("0.02"));
      const attempts = new Attempts(money, make());
      const a = attempts.start(AGENT, "blackbox", SEED)!;
      await attempts.ask(a.id, { side: "left", index: 0 });
      await attempts.ask(a.id, { side: "left", index: 1 });
      expect(attempts.get(a.id)!.outcome).toBe("refused");
      expect(attempts.get(a.id)!.endedAt).not.toBeNull();
    });
  });
}

describe("sqlite survives the restart that a Map does not", () => {
  test("a finished run is still there when the process comes back", async () => {
    const path = scratch();
    const money = new InMemoryAllowance();
    money.grant(AGENT, usdc("5"));

    // First process.
    const before = new SqliteStore(path);
    const attempts = new Attempts(money, before);
    const a = attempts.start(AGENT, "blackbox", SEED)!;
    await attempts.ask(a.id, { side: "left", index: 0 });
    await attempts.submit(a.id, boardFrom(SEED).atoms);
    before.close();

    // It restarts. Nothing is in memory any more.
    const after = new SqliteStore(path);
    const found = after.get(a.id);
    expect(found).toBeDefined();
    expect(found!.outcome).toBe("solved");
    expect(format(found!.spend)).toBe("0.020000");
    expect(found!.probes).toHaveLength(1);
    expect(found!.probes[0]!.question).toEqual({ side: "left", index: 0 });
    after.close();
  });

  test("the leaderboard is still a leaderboard after a restart", async () => {
    const path = scratch();
    const money = new InMemoryAllowance();

    const first = new SqliteStore(path);
    const attempts = new Attempts(money, first);
    for (const agent of ["agent:one", "agent:two"]) {
      money.grant(agent, usdc("5"));
      const a = attempts.start(agent, "blackbox", SEED)!;
      await attempts.submit(a.id, boardFrom(SEED).atoms);
    }
    first.close();

    const second = new SqliteStore(path);
    expect(second.all()).toHaveLength(2);
    expect(second.all().every((a) => a.outcome === "solved")).toBe(true);
    second.close();
  });

  test("money round-trips exactly, with no float anywhere near it", async () => {
    const path = scratch();
    const money = new InMemoryAllowance();
    money.grant(AGENT, usdc("5"));

    const one = new SqliteStore(path);
    const attempts = new Attempts(money, one);
    const a = attempts.start(AGENT, "blackbox", SEED, usdc("0.4"))!;
    for (let i = 0; i < 7; i++) await attempts.ask(a.id, { side: "left", index: i });
    one.close();

    const two = new SqliteStore(path);
    const back = two.get(a.id)!;
    expect(back.spend).toBe(usdc("0.14"));          // exact bigint, not 0.14000000000000001
    expect(back.budget).toBe(usdc("0.4"));
    expect(format(back.spend)).toBe("0.140000");
    two.close();
  });

  test("ids do not collide across restarts", async () => {
    const path = scratch();
    const money = new InMemoryAllowance();
    money.grant(AGENT, usdc("5"));

    const one = new SqliteStore(path);
    const a1 = new Attempts(money, one).start(AGENT, "blackbox", SEED)!;
    one.close();

    const two = new SqliteStore(path);
    const a2 = new Attempts(money, two).start(AGENT, "blackbox", SEED)!;
    expect(a2.id).not.toBe(a1.id);
    expect(two.all()).toHaveLength(2);
    two.close();
  });
});

/**
 * Opening a database written by an older build.
 *
 * `CREATE TABLE IF NOT EXISTS` is a no-op once the table exists, so a column added later never
 * reaches a database somebody already has. The failure is invisible at startup and lands on the
 * first write — in production, on real data, not here.
 */
describe("a database from before the payer column", () => {
  /** The exact schema shipped before `payer` existed, written by hand. */
  const older = (path: string) => {
    const db = new Database(path, { create: true });
    db.exec(`
      CREATE TABLE attempts (
        id TEXT PRIMARY KEY, agent TEXT NOT NULL, problem TEXT NOT NULL, seed INTEGER NOT NULL,
        started_at INTEGER NOT NULL, ended_at INTEGER, outcome TEXT NOT NULL,
        probes TEXT NOT NULL, submissions INTEGER NOT NULL,
        spend TEXT NOT NULL, budget TEXT, state TEXT
      );
      CREATE TABLE submissions (
        agent TEXT NOT NULL, problem TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (agent, problem)
      );
      INSERT INTO attempts VALUES
        ('a1', 'agent:old', 'blackbox', 7, 1000, 2000, 'solved', '[]', 1, '20000', NULL, NULL);
    `);
    db.close();
  };

  test("opening it adds the column instead of failing on the first write", () => {
    const path = scratch();
    older(path);
    const store = new SqliteStore(path);
    const a = store.get("a1")!;
    expect(a.agent).toBe("agent:old");
    expect(a.payer).toBe(null);
  });

  test("the old rows keep their money and their outcome", () => {
    const path = scratch();
    older(path);
    const a = new SqliteStore(path).get("a1")!;
    expect(format(a.spend)).toBe(format(usdc("0.02")));
    expect(a.outcome).toBe("solved");
  });

  test("a run started after the upgrade can bind a payer and keep it", () => {
    const path = scratch();
    older(path);
    const store = new SqliteStore(path);
    const at = new Attempts(new InMemoryAllowance(), store).start(AGENT, "blackbox", "7")!;
    at.payer = "0xabc";
    store.put(at);
    expect(store.get(at.id)!.payer).toBe("0xabc");
  });

  test("opening twice is harmless: the migration does not run again", () => {
    const path = scratch();
    older(path);
    new SqliteStore(path);
    expect(() => new SqliteStore(path)).not.toThrow();
    expect(new SqliteStore(path).get("a1")!.payer).toBe(null);
  });
});
