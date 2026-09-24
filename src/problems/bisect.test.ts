import { expect, test, describe } from "bun:test";
import { bisect, historyFrom, test as run, COMMITS, KNOWN_BAD, KNOWN_GOOD, type Verdict } from "./bisect.ts";
import { Attempts } from "../attempt.ts";
import { InMemoryAllowance } from "../payments.ts";
import { usdc } from "../money.ts";
import { PRICE } from "../pricing.ts";

const SEEDS = Array.from({ length: 400 }, (_, i) => `bisect-${i}`);

/**
 * A reference solver: binary search that steps around commits it cannot test.
 *
 * Between the last known good commit and the first known bad one, test the middle. If it does not
 * build, try its neighbours, nearest first, alternating sides, until one does. Whatever that
 * neighbour says narrows the gap the same way the middle would have, only less evenly.
 */
async function solve(test: (commit: number) => Promise<Verdict>): Promise<{ firstBad: number; asked: number }> {
  let good = KNOWN_GOOD, bad = KNOWN_BAD, asked = 0;
  const untestable = new Set<number>();
  while (bad - good > 1) {
    const mid = (good + bad) >> 1;
    let verdict: Verdict = "untestable";
    let at = mid;
    for (let step = 0; verdict === "untestable"; step++) {
      at = mid + (step % 2 === 0 ? step / 2 : -(step + 1) / 2);
      if (at <= good || at >= bad || untestable.has(at)) {
        if (step > 2 * (bad - good)) throw new Error("every commit in the gap is broken, which the history rules out");
        continue;
      }
      verdict = await test(at);
      asked++;
      if (verdict === "untestable") untestable.add(at);
    }
    if (verdict === "good") good = at; else bad = at;
  }
  return { firstBad: bad, asked };
}

describe("a history comes from the seed alone", () => {
  test("the same seed gives the same history", () => {
    expect(historyFrom("7")).toEqual(historyFrom("7"));
  });

  test("everything before the first bad commit is good and everything from it is bad", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const h = historyFrom(seed);
      for (let c = 0; c < COMMITS; c++) {
        const v = run(h, c);
        if (v !== "untestable") expect(v).toBe(c < h.firstBad ? "good" : "bad");
      }
    }
  });

  test("the answer can always be decided: the ends, the first bad commit and the one before it all build", () => {
    for (const seed of SEEDS) {
      const h = historyFrom(seed);
      expect(h.firstBad).toBeGreaterThan(KNOWN_GOOD);
      expect(h.firstBad).toBeLessThanOrEqual(KNOWN_BAD);
      for (const c of [KNOWN_GOOD, KNOWN_BAD, h.firstBad - 1, h.firstBad]) expect(h.broken.has(c)).toBe(false);
    }
  });

  test("every history has broken commits", () => {
    for (const seed of SEEDS) expect(historyFrom(seed).broken.size).toBeGreaterThan(0);
  });
});

describe("the problem, through its interface", () => {
  const seed = "4242";
  test("a test reports the commit and its verdict", () => {
    const h = historyFrom(seed);
    expect(bisect.probe(seed, { test: h.firstBad }, null)!.answer).toEqual({ commit: h.firstBad, result: "bad" });
    expect(bisect.probe(seed, { test: h.firstBad - 1 }, null)!.answer).toEqual({ commit: h.firstBad - 1, result: "good" });
    const broken = [...h.broken][0]!;
    expect(bisect.probe(seed, { test: broken }, null)!.answer).toEqual({ commit: broken, result: "untestable" });
  });
  test("malformed tests are refused, and so are not charged", () => {
    for (const bad of [null, 5, {}, { test: -1 }, { test: COMMITS }, { test: 1.5 }, { test: "12" }]) {
      expect(bisect.probe(seed, bad, null)).toBeNull();
    }
  });
  test("the checker wants the first bad commit, not a bad one", () => {
    const { firstBad } = historyFrom(seed);
    expect(bisect.check(seed, firstBad)).toBe(true);
    expect(bisect.check(seed, firstBad + 1)).toBe(false);
    expect(bisect.check(seed, firstBad - 1)).toBe(false);
    expect(bisect.check(seed, String(firstBad))).toBe(false);
  });
});

describe("what it costs", () => {
  test("twelve tests when nothing broken is in the way, and the solver is always right", async () => {
    let clean = 0;
    for (const seed of SEEDS) {
      const h = historyFrom(seed);
      let hitBroken = false;
      const out = await solve(async (c) => { const v = run(h, c); if (v === "untestable") hitBroken = true; return v; });
      expect(out.firstBad).toBe(h.firstBad);
      if (!hitBroken) { clean++; expect(out.asked).toBeLessThanOrEqual(12); }
    }
    expect(clean).toBeGreaterThan(SEEDS.length / 2);   // most histories never put a broken build in the way
  });

  test("a broken build in the way costs extra, which is the point of the problem", async () => {
    let extra = 0;
    for (const seed of SEEDS) {
      const h = historyFrom(seed);
      const out = await solve(async (c) => run(h, c));
      if (out.asked > 12) extra++;
    }
    expect(extra).toBeGreaterThan(0);
  });
});

describe("a run, end to end", () => {
  test("solved through the lifecycle, and it cost what it asked", async () => {
    const money = new InMemoryAllowance();
    money.grant("agent:bisector", usdc("5"));
    const attempts = new Attempts(money);
    const a = attempts.start("agent:bisector", "bisect", "4242")!;
    const out = await solve(async (c) =>
      ((await attempts.ask(a.id, { test: c })) as { answer: { result: Verdict } }).answer.result);
    expect((await attempts.submit(a.id, out.firstBad) as { solved: boolean }).solved).toBe(true);
    expect(attempts.get(a.id)!.spend).toBe(PRICE.ask * BigInt(out.asked));
  });
});
