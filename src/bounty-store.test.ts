import { expect, test, describe, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { SqliteBounties, MemoryBounties, type BountyStore } from "./bounty-store.ts";
import { Bounties } from "./bounties.ts";
import { usdc, format } from "./money.ts";

const dirs: string[] = [];
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), "bench-b-"));
  dirs.push(d);
  return join(d, "b.sqlite");
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const DEADLINE = Date.now() + 7 * 24 * 3600 * 1000;
const SECRET = 424242;

const postOne = (b: Bounties, over: Record<string, unknown> = {}) => {
  const p = b.post({
    poster: "agent:acme", title: "Find it", statement: "Work it out.",
    checker: { kind: "equals", value: SECRET }, amount: "500.00", deadline: DEADLINE, ...over,
  });
  if (!p.ok) throw new Error(p.problem);
  return p.bounty;
};

describe.each([
  ["memory", () => new MemoryBounties()],
  ["sqlite", () => new SqliteBounties(scratch())],
])("a bounty store: %s", (_name, make) => {
  test("what goes in comes back out", () => {
    const store: BountyStore = make();
    const b = postOne(new Bounties(store));
    const got = store.get(b.id)!;
    expect(got.title).toBe("Find it");
    expect(format(got.amount)).toBe(format(usdc("500")));
    expect(got.minRating).toBe(0);
  });

  test("the checker survives, which is the whole point", () => {
    const store = make();
    const bounties = new Bounties(store);
    const b = postOne(bounties);
    expect(new Bounties(store).solve(b.id, SECRET, "0xabc", []).ok).toBe(true);
  });

  test("a win is written, not just held in memory", () => {
    const store = make();
    new Bounties(store).solve(postOne(new Bounties(store)).id, SECRET, "0xabc", []);
    expect(store.all()[0]!.solvedBy).toBe("0xabc");
  });

  test("a failed attempt still counts, so a poster sees the interest", () => {
    const store = make();
    const b = postOne(new Bounties(store));
    new Bounties(store).solve(b.id, 0, "0xabc", []);
    expect(store.get(b.id)!.attempts).toBe(1);
  });

  test("ids do not collide across restarts", () => {
    const store = make();
    postOne(new Bounties(store));
    const second = postOne(new Bounties(store)); // a fresh Bounties, as after a deploy
    expect(second.id).not.toBe("b1");
    expect(store.all()).toHaveLength(2);
  });
});

/**
 * The defect this store exists for.
 *
 * A bounty holds real money in escrow on chain. Losing the checker does not lose a leaderboard — it
 * strands the poster's USDC, because the only thing that could ever release it is gone. This is the
 * test that would have caught it.
 */
describe("across a real restart", () => {
  test("a bounty posted before the restart can still be won after it", () => {
    const path = scratch();
    const before = new Bounties(new SqliteBounties(path));
    const b = postOne(before, { minRating: 0 });

    const after = new Bounties(new SqliteBounties(path)); // a different process would see this
    expect(after.get(b.id)).toBeDefined();
    expect(after.solve(b.id, SECRET, "0xabc", []).ok).toBe(true);
  });

  test("money round-trips exactly, to the last micro", () => {
    const path = scratch();
    postOne(new Bounties(new SqliteBounties(path)), { amount: "1234.567891" });
    expect(format(new SqliteBounties(path).all()[0]!.amount)).toBe("1234.567891");
  });

  test("a bounty already won stays won", () => {
    const path = scratch();
    const b = postOne(new Bounties(new SqliteBounties(path)));
    new Bounties(new SqliteBounties(path)).solve(b.id, SECRET, "0xabc", []);
    const after = new Bounties(new SqliteBounties(path));
    const again = after.solve(b.id, SECRET, "0xdead", []);
    expect(again.ok).toBe(false);
    expect(after.get(b.id)!.solvedBy).toBe("0xabc");
  });

  /**
   * A row can be edited, restored from an old backup, or written by a build where a pattern was
   * still allowed. A checker that no longer validates has to be caught on the way out — one broken
   * bounty — not inside `run` while a paid submission is being graded.
   */
  test("a corrupted checker is skipped on load, not crashed on while grading", () => {
    const path = scratch();
    const b = postOne(new Bounties(new SqliteBounties(path)));

    const db = new Database(path);
    db.query("UPDATE bounties SET checker = ? WHERE id = ?")
      .run(JSON.stringify({ kind: "matches", pattern: "(a+)+$" }), b.id);
    db.close();

    const after = new SqliteBounties(path);
    expect(after.get(b.id)).toBeUndefined();
    expect(after.all()).toHaveLength(0);
  });

  test("one unusable bounty does not hide the others", () => {
    const path = scratch();
    const bounties = new Bounties(new SqliteBounties(path));
    const bad = postOne(bounties);
    const good = postOne(bounties, { title: "Still here" });

    const db = new Database(path);
    db.query("UPDATE bounties SET checker = ? WHERE id = ?").run('{"kind":"nope"}', bad.id);
    db.close();

    const after = new SqliteBounties(path);
    expect(after.all().map((x) => x.id)).toEqual([good.id]);
  });
});
