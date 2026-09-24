import { expect, test, describe, beforeEach } from "bun:test";
import {
  Attempts, score, wireAttempt, wireScore, type Refusal, type Asked, type Graded,
} from "./attempt.ts";
import { InMemoryAllowance } from "./payments.ts";
import { usdc, format } from "./money.ts";
import { boardFrom, ports, type RayResult } from "./problems/blackbox.ts";
import "./problems/blackbox-problem.ts";
import { PRICE, submissionPrice } from "./pricing.ts";

const AGENT = "agent:aria";
const SEED = "4242";

let money: InMemoryAllowance;
let attempts: Attempts;

beforeEach(() => {
  money = new InMemoryAllowance();
  money.grant(AGENT, usdc("5"));
  attempts = new Attempts(money);
});

const isRefusal = (r: unknown): r is Refusal => typeof r === "object" && r !== null && "refused" in r;
const solutionFor = (seed: string) => boardFrom(seed).atoms;

describe("starting is free; you pay to learn, not to arrive", () => {
  test("no charge to start", async () => {
    attempts.start(AGENT, "blackbox", SEED)!;
    expect(money.spentBy(AGENT)).toBe(0n);
  });
});

describe("a probe costs, and answers", () => {
  test("one ray charges the list price and returns a result", async () => {
    const a = attempts.start(AGENT, "blackbox", SEED)!;
    const r = await attempts.ask(a.id, { side: "left", index: 0 });
    expect(isRefusal(r)).toBe(false);
    const asked = r as Asked;
    expect(asked.paid).toBe(PRICE.ask);
    expect(["hit", "reflect", "detour"]).toContain((asked.answer as RayResult).kind);
    expect(money.spentBy(AGENT)).toBe(PRICE.ask);
  });

  test("spend accumulates exactly, with no float drift over many probes", async () => {
    const a = attempts.start(AGENT, "blackbox", SEED)!;
    for (const p of ports(8)) await attempts.ask(a.id, p);
    expect(attempts.get(a.id)!.spend).toBe(PRICE.ask * 32n);
    expect(format(money.spentBy(AGENT))).toBe("0.640000");
  });
});

describe("the first graded submission is free, then it bites", () => {
  test("first is free, next two are list price, then it doubles", () => {
    expect(submissionPrice(0)).toBe(0n);
    expect(submissionPrice(1)).toBe(PRICE.submit);
    expect(submissionPrice(2)).toBe(PRICE.submit);
    expect(submissionPrice(3)).toBe(PRICE.submit * 2n);
    expect(submissionPrice(4)).toBe(PRICE.submit * 4n);
  });

  test("a first wrong guess costs nothing but is recorded", async () => {
    const a = attempts.start(AGENT, "blackbox", SEED)!;
    const g = (await attempts.submit(a.id, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }])) as Graded;
    expect(g.solved).toBe(false);
    expect(g.paid).toBe(0n);
    expect(g.submissions).toBe(1);
    expect(attempts.get(a.id)!.outcome).toBe("open");
  });

  test("brute force gets expensive fast", async () => {
    const a = attempts.start(AGENT, "blackbox", SEED)!;
    const wrong = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
    for (let i = 0; i < 6; i++) await attempts.submit(a.id, wrong);
    // free + 0.05 + 0.05 + 0.10 + 0.20 + 0.40
    expect(format(attempts.get(a.id)!.spend)).toBe("0.800000");
  });
});

describe("solving ends the run", () => {
  test("the right atoms solve it, and the attempt closes", async () => {
    const a = attempts.start(AGENT, "blackbox", SEED)!;
    const g = (await attempts.submit(a.id, solutionFor(SEED))) as Graded;
    expect(g.solved).toBe(true);
    const done = attempts.get(a.id)!;
    expect(done.outcome).toBe("solved");
    expect(done.endedAt).not.toBeNull();
  });

  test("a closed attempt refuses further work rather than quietly accepting it", async () => {
    const a = attempts.start(AGENT, "blackbox", SEED)!;
    await attempts.submit(a.id, solutionFor(SEED));
    expect(attempts.ask(a.id, { side: "left", index: 0 })).rejects.toThrow(/solved/);
  });
});

describe("running out is a result, not an error", () => {
  test("an exhausted allowance refuses, ends the run, and says what was left", async () => {
    money.grant(AGENT, usdc("0.05"));           // two probes and no more
    const a = attempts.start(AGENT, "blackbox", SEED)!;
    await attempts.ask(a.id, { side: "left", index: 0 });
    await attempts.ask(a.id, { side: "left", index: 1 });
    const r = await attempts.ask(a.id, { side: "left", index: 2 });

    expect(isRefusal(r)).toBe(true);
    const refusal = r as Refusal;
    expect(refusal.refused).toBe("allowance");
    expect(refusal.wanted).toBe(PRICE.ask);
    expect(format(refusal.remaining)).toBe("0.010000");
    expect(attempts.get(a.id)!.outcome).toBe("refused");
  });

  test("nothing is charged for the action that was refused", async () => {
    money.grant(AGENT, usdc("0.05"));
    const a = attempts.start(AGENT, "blackbox", SEED)!;
    await attempts.ask(a.id, { side: "left", index: 0 });
    await attempts.ask(a.id, { side: "left", index: 1 });
    await attempts.ask(a.id, { side: "left", index: 2 });
    expect(format(money.spentBy(AGENT))).toBe("0.040000");
  });

  test("a problem's budget refuses separately from the allowance, and says which", async () => {
    const a = attempts.start(AGENT, "blackbox", SEED, usdc("0.05"))!;   // rich agent, tight problem
    await attempts.ask(a.id, { side: "left", index: 0 });
    await attempts.ask(a.id, { side: "left", index: 1 });
    const r = (await attempts.ask(a.id, { side: "left", index: 2 })) as Refusal;
    expect(r.refused).toBe("budget");
    expect(money.remaining(AGENT)).toBeGreaterThan(0n);
  });
});

describe("the score is the record, with nothing derived at read time", () => {
  test("a solved run carries spend, probes and how it ended", async () => {
    const a = attempts.start(AGENT, "blackbox", SEED)!;
    await attempts.ask(a.id, { side: "left", index: 0 });
    await attempts.ask(a.id, { side: "up", index: 3 });
    await attempts.submit(a.id, solutionFor(SEED));
    const s = score(attempts.get(a.id)!);
    expect(s.solved).toBe(true);
    expect(s.probes).toBe(2);
    expect(s.submissions).toBe(1);
    expect(s.endedBy).toBe("solved");
    expect(s.spend).toBe(PRICE.ask * 2n);
    expect(s.seed).toBe(SEED);
  });

  test("a refused run is a complete record, not a missing one", async () => {
    money.grant(AGENT, usdc("0.02"));
    const a = attempts.start(AGENT, "blackbox", SEED)!;
    await attempts.ask(a.id, { side: "left", index: 0 });
    await attempts.ask(a.id, { side: "left", index: 1 });
    const s = score(attempts.get(a.id)!);
    expect(s.solved).toBe(false);
    expect(s.endedBy).toBe("refused");
    expect(s.probes).toBe(1);
    expect(s.spend).toBe(PRICE.ask);
  });
});

describe("the solution never leaves the server", () => {
  test("an attempt carries a seed, not a board", () => {
    const a = attempts.start(AGENT, "blackbox", SEED)!;
    expect(a).not.toHaveProperty("board");
    expect(JSON.stringify(wireAttempt(a))).not.toContain("atoms");
  });
});

describe("money crosses the wire as a string, because bigint cannot cross at all", () => {
  test("an attempt straight from the store is not serialisable, and that is the point", async () => {
    const a = attempts.start(AGENT, "blackbox", SEED)!;
    await attempts.ask(a.id, { side: "left", index: 0 });
    expect(() => JSON.stringify(attempts.get(a.id))).toThrow();
  });

  test("the wire form serialises, with six places and no rounding", async () => {
    const a = attempts.start(AGENT, "blackbox", SEED)!;
    await attempts.ask(a.id, { side: "left", index: 0 });
    const json = JSON.parse(JSON.stringify(wireAttempt(attempts.get(a.id)!)));
    expect(json.spend).toBe("0.020000");
    expect(typeof json.spend).toBe("string");
  });

  test("a score crosses too, budget included when there is one", async () => {
    const a = attempts.start(AGENT, "blackbox", SEED, usdc("0.40"))!;
    await attempts.ask(a.id, { side: "left", index: 0 });
    await attempts.submit(a.id, solutionFor(SEED));
    const json = JSON.parse(JSON.stringify(wireScore(score(attempts.get(a.id)!))));
    expect(json.spend).toBe("0.020000");
    expect(json.solved).toBe(true);
    expect(JSON.parse(JSON.stringify(wireAttempt(attempts.get(a.id)!))).budget).toBe("0.400000");
  });
});

describe("the ledger agrees with the attempts", () => {
  test("every charge logged matches what the attempts think they spent", async () => {
    const a = attempts.start(AGENT, "blackbox", SEED)!;
    await attempts.ask(a.id, { side: "left", index: 0 });
    await attempts.submit(a.id, [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]);
    await attempts.ask(a.id, { side: "right", index: 5 });
    const charged = money.log.filter((l) => l.ok).reduce((t, l) => t + l.amount, 0n);
    expect(charged).toBe(attempts.get(a.id)!.spend);
    expect(charged).toBe(money.spentBy(AGENT));
  });
});

/**
 * Concurrency, which every other test in this file hides by awaiting each call.
 *
 * A run was read, a payment awaited, then the run mutated and stored — so two requests read the
 * same state and the second write erased the first. Five probes fired at once against a $0.05 cap
 * were all answered, charged $0.10, and recorded as $0.02 and one probe.
 *
 * That is not lost accuracy. The leaderboard ranks by recorded spend, so `Promise.all` bought every
 * answer and booked a fraction of the cost — the rational play when the score is the prize.
 */
describe("several requests at once", () => {
  /**
   * `allSettled`, not `all`. Once the cap closes the run, probes still queued behind it are asking
   * about a finished run and throw — which is the same "that run is over" the HTTP layer turns into
   * a 409. Before serialising, all five were answered and none of this could happen.
   */
  const fire = async (n: number, budget: string) => {
    const money = new InMemoryAllowance();
    money.grant(AGENT, usdc("50"));
    const runs = new Attempts(money);
    const at = runs.start(AGENT, "blackbox", SEED, usdc(budget))!;
    const settled = await Promise.allSettled(
      Array.from({ length: n }, (_, i) => runs.ask(at.id, { side: "up", index: i })),
    );
    const out = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const overRun = settled.filter((r) => r.status === "rejected").length;
    return { money, runs, at: runs.get(at.id)!, out, overRun };
  };

  test("a budget cap holds against parallel probes", async () => {
    const { at, out, overRun } = await fire(5, "0.05");   // $0.05 buys two probes
    expect(out.filter((r) => "answer" in r)).toHaveLength(2);
    expect(out.filter((r) => "refused" in r)).toHaveLength(1);
    expect(overRun).toBe(2);                              // asked after the run had closed
    expect(at.spend).toBe(usdc("0.04"));
  });

  test("what was charged is what was recorded", async () => {
    const { money, at } = await fire(5, "0.05");
    expect(money.spentBy(AGENT)).toBe(at.spend);
  });

  test("every answered probe is on the record", async () => {
    const { at, out } = await fire(5, "1.00");
    expect(at.probes).toHaveLength(out.filter((r) => "answer" in r).length);
    expect(at.spend).toBe(BigInt(at.probes.length) * PRICE.ask);
  });

  test("nothing is lost when there is budget for all of them", async () => {
    const { money, at } = await fire(8, "1.00");
    expect(at.probes).toHaveLength(8);
    expect(at.spend).toBe(usdc("0.16"));
    expect(money.spentBy(AGENT)).toBe(usdc("0.16"));
  });

  /**
   * The submission price is a counter shared by every run an agent has on a problem, so serialising
   * per run is not enough — concurrent first-submissions on four different runs were all charged
   * nothing, and the doubling that punishes brute force did not happen.
   */
  test("the repeat price is not defeated by using several runs at once", async () => {
    const money = new InMemoryAllowance();
    money.grant(AGENT, usdc("50"));
    const runs = new Attempts(money);
    const ids = [0, 1, 2, 3].map(() => runs.start(AGENT, "blackbox", SEED)!.id);
    await Promise.all(ids.map((id) => runs.submit(id, [{ x: 0, y: 0 }])));

    // Free, list, list, then the first doubling — the schedule applied in order, which is the
    // whole point. Concurrently it used to charge nothing at all.
    const expected = [0, 1, 2, 3].reduce((total, prior) => total + submissionPrice(prior), 0n);
    expect(expected).toBe(usdc("0.20"));
    expect(money.spentBy(AGENT)).toBe(expected);
  });

  test("runs of different agents do not queue behind each other", async () => {
    const money = new InMemoryAllowance();
    const runs = new Attempts(money);
    const ids = ["a", "b", "c", "d"].map((n) => {
      money.grant(`agent:${n}`, usdc("5"));
      return runs.start(`agent:${n}`, "blackbox", SEED)!.id;
    });
    const started = performance.now();
    await Promise.all(ids.map((id) => runs.ask(id, { side: "up", index: 0 })));
    expect(performance.now() - started).toBeLessThan(200);
    for (const id of ids) expect(runs.get(id)!.probes).toHaveLength(1);
  });
});
