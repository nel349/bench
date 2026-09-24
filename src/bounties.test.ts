import { expect, test, describe, beforeEach } from "bun:test";
import { Bounties, wireBounty, MIN_DURATION_MS } from "./bounties.ts";
import { usdc } from "./money.ts";
import "./problems/blackbox-problem.ts";
import "./problems/zendo.ts";
import "./problems/toll.ts";

const POSTER = "agent:acme";
const SOLVER = "0xabc0000000000000000000000000000000000001";
const NOW = 1_700_000_000_000;
const LATER = NOW + 7 * 24 * 3600 * 1000;

let bounties: Bounties;
beforeEach(() => { bounties = new Bounties(); });

const SECRET = 424242;
const spec = { kind: "equals", value: SECRET };

const post = (over: Record<string, unknown> = {}) => bounties.post({
  poster: POSTER, title: "Find the number", statement: "Work out the number.",
  checker: spec, amount: "500.00", deadline: LATER, ...over,
}, NOW);

const posted = (over: Record<string, unknown> = {}) => {
  const p = post(over);
  if (!p.ok) throw new Error(`refused: ${p.problem}`);
  return p.bounty;
};

describe("posting one", () => {
  test("it holds what was posted", () => {
    const b = posted();
    expect(b.amount).toBe(usdc("500"));
    expect(b.title).toBe("Find the number");
    expect(b.solvedBy).toBe(null);
  });

  test("a broken answer key is refused now, not while grading someone's answer", () => {
    const p = post({ checker: { kind: "nonsense" } });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.problem).toContain("unknown kind");
  });

  test("a catastrophic regex in an answer key never gets posted", () => {
    const p = post({ checker: { kind: "matches", pattern: "(a+)+$" } });
    if (!p.ok) expect(p.problem).toContain("exponential");
    expect(p.ok).toBe(false);
  });

  test("an amount is a decimal string, never a float", () => {
    expect(post({ amount: 500 }).ok).toBe(false);
    expect(post({ amount: "nope" }).ok).toBe(false);
    expect(post({ amount: "0" }).ok).toBe(false);
  });

  test("a deadline nobody could meet is refused", () => {
    expect(post({ deadline: NOW + MIN_DURATION_MS - 1 }).ok).toBe(false);
    expect(post({ deadline: NOW + MIN_DURATION_MS + 1 }).ok).toBe(true);
  });

  test("a bounty needs a title and a statement", () => {
    expect(post({ title: "  " }).ok).toBe(false);
    expect(post({ statement: "" }).ok).toBe(false);
  });
});

/**
 * The answer key is the thing being paid for. Every route returns bounties through `wireBounty`,
 * which has no field for it — so this is checked on the shape rather than on each route.
 */
describe("the answer key never leaves", () => {
  test("the wire shape has no checker on it", () => {
    const w = wireBounty(posted(), NOW) as unknown as Record<string, unknown>;
    expect("checker" in w).toBe(false);
  });

  test("and the secret is nowhere in the serialised form", () => {
    expect(JSON.stringify(wireBounty(posted(), NOW))).not.toContain(String(SECRET));
  });

  test("a wrong answer is told why without being told what", () => {
    const out = bounties.solve(posted().id, 1, SOLVER, 0, NOW);
    expect(out.ok).toBe(false);
    if (out.ok || !("because" in out)) return;
    expect(out.because).not.toContain(String(SECRET));
  });
});

describe("solving one", () => {
  test("the right answer wins it, and names the address that paid", () => {
    const b = posted();
    const out = bounties.solve(b.id, SECRET, SOLVER, 0, NOW);
    expect(out).toEqual({ ok: true, solver: SOLVER });
    expect(bounties.get(b.id)!.solvedBy).toBe(SOLVER);
  });

  test("a wrong answer leaves it open for someone else", () => {
    const b = posted();
    bounties.solve(b.id, 1, SOLVER, 0, NOW);
    expect(bounties.get(b.id)!.solvedBy).toBe(null);
    expect(wireBounty(bounties.get(b.id)!, NOW).open).toBe(true);
  });

  test("it can only be won once", () => {
    const b = posted();
    bounties.solve(b.id, SECRET, SOLVER, 0, NOW);
    const second = bounties.solve(b.id, SECRET, "0xdd", 0, NOW);
    expect(second.ok).toBe(false);
    if (!second.ok && "closed" in second) expect(second.closed).toContain("already been won");
    expect(bounties.get(b.id)!.solvedBy).toBe(SOLVER);
  });

  test("an expired bounty cannot be won", () => {
    const b = posted();
    const out = bounties.solve(b.id, SECRET, SOLVER, 0, LATER + 1);
    expect(out.ok).toBe(false);
    if (!out.ok && "closed" in out) expect(out.closed).toContain("expired");
  });

  test("attempts are counted, so a poster can see the interest", () => {
    const b = posted();
    bounties.solve(b.id, 1, SOLVER, 0, NOW);
    bounties.solve(b.id, 2, SOLVER, 0, NOW);
    expect(bounties.get(b.id)!.attempts).toBe(2);
  });

  test("without a payer there is nobody to pay, so it is refused", () => {
    const out = bounties.solve(posted().id, SECRET, null, 0, NOW);
    expect(out.ok).toBe(false);
  });
});

describe("the qualification gate", () => {
  test("an agent with no record cannot attempt a gated bounty", async () => {
    const b = posted({ minRating: 2 });
    const out = bounties.solve(b.id, SECRET, SOLVER, 0, NOW);
    expect(out.ok).toBe(false);
    if (!out.ok && "unqualified" in out) {
      expect(out.rating).toBe(0);
      expect(out.needs).toBe(2);
    }
  });

  /**
   * The gate runs *before* the answer is graded, and that ordering is the security property. If
   * grading came first, a bounty would leak its answer key to anyone willing to be told "not
   * qualified" a few hundred times.
   */
  test("an unqualified agent cannot learn whether its answer was right", () => {
    const b = posted({ minRating: 5 });
    const right = bounties.solve(b.id, SECRET, SOLVER, 0, NOW);
    const wrong = bounties.solve(b.id, 0, SOLVER, 0, NOW);
    expect(right).toEqual(wrong);                       // indistinguishable
    expect(bounties.get(b.id)!.solvedBy).toBe(null);    // and it did not win
    expect(bounties.get(b.id)!.attempts).toBe(0);       // it never even counted as an attempt
  });

  /**
   * The gate decides against a number and nothing else. Where that number comes from, the ranked
   * runs on an agent's ERC-8004 identity, is `rating.test.ts` and the routes in `http.test.ts`.
   */
  test("a rating at the bar opens it, and one short of the bar does not", () => {
    expect(bounties.solve(posted({ minRating: 5 }).id, SECRET, SOLVER, 5, NOW).ok).toBe(true);
    const short = bounties.solve(posted({ minRating: 5 }).id, SECRET, SOLVER, 4, NOW);
    expect(short).toMatchObject({ ok: false, unqualified: true, rating: 4, needs: 5 });
  });

  test("the free check and the paid one agree", () => {
    const b = posted({ minRating: 3 });
    expect(bounties.eligibility(b.id, SOLVER, 2, NOW)).toMatchObject({ ok: false, rating: 2, needs: 3 });
    expect(bounties.eligibility(b.id, SOLVER, 3, NOW)).toEqual({ ok: true });
  });

  test("an ungated bounty is open to anyone who pays", () => {
    expect(bounties.solve(posted({ minRating: 0 }).id, SECRET, SOLVER, 0, NOW).ok).toBe(true);
  });

});

/**
 * Money on the wire.
 *
 * Every amount in this API is a decimal string with six places. This one crossed as raw micros for
 * a while and the page rendered "$500000000", which no test caught because the fixtures were
 * hand-written in the right format while the code produced the wrong one.
 */
describe("what an amount looks like leaving the process", () => {
  test("it is the same shape as every other amount in the API", () => {
    expect(wireBounty(posted({ amount: "500.00" }), NOW).amount).toBe("500.000000");
  });

  test("it is not raw micros", () => {
    expect(wireBounty(posted({ amount: "500.00" }), NOW).amount).not.toBe("500000000");
  });

  test("it round-trips through the parser exactly", () => {
    for (const written of ["0.01", "1.50", "500.00", "1234.567891"]) {
      const out = wireBounty(posted({ amount: written }), NOW).amount;
      expect(usdc(out)).toBe(usdc(written));
    }
  });
});

/**
 * Being refused should not cost anything.
 *
 * The route charged a graded-submission fee and *then* ran the qualification gate, so an agent with
 * no record paid $0.05 to be told it could not play — the same tax on a rejected request that a
 * malformed probe is deliberately spared. Found while planning the first real bounty, by working
 * out what it would cost to demonstrate a refusal.
 */
describe("the gate is free", () => {
  test("an unqualified name is refused without being charged", () => {
    const b = posted({ minRating: 2 });
    const out = bounties.eligibility(b.id, SOLVER, 0, NOW);
    expect(out.ok).toBe(false);
    if (!out.ok && "unqualified" in out) {
      expect(out.rating).toBe(0);
      expect(out.needs).toBe(2);
    }
  });

  test("an ungated bounty needs no record, so nothing is looked up", () => {
    expect(bounties.eligibility(posted({ minRating: 0 }).id, SOLVER, 0, NOW).ok).toBe(true);
  });

  test("a closed bounty is refused before payment too", () => {
    const b = posted();
    bounties.solve(b.id, SECRET, SOLVER, 0, NOW);
    const out = bounties.eligibility(b.id, SOLVER, 0, NOW);
    expect(out.ok).toBe(false);
    if (!out.ok && "closed" in out) expect(out.closed).toContain("already been won");
  });

  test("an expired bounty likewise", () => {
    const out = bounties.eligibility(posted().id, SOLVER, 0, LATER + 1);
    expect(out.ok).toBe(false);
  });

  test("it does not grade, so it cannot leak the answer", () => {
    const b = posted({ minRating: 2 });
    // Qualified: the gate passes and says nothing about whether any answer is right.
    expect(JSON.stringify(bounties.eligibility(b.id, SOLVER, 2, NOW))).not.toContain(String(SECRET));
    expect(bounties.get(b.id)!.attempts).toBe(0);
  });

  test("checking eligibility never counts as an attempt", () => {
    const b = posted({ minRating: 5 });
    for (let i = 0; i < 5; i++) bounties.eligibility(b.id, SOLVER, 0, NOW);
    expect(bounties.get(b.id)!.attempts).toBe(0);
  });
});
