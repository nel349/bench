import { expect, test, describe } from "bun:test";
import { better, orderFrom, parseOrder, ranking, ITEMS, ORDERS } from "./ranking.ts";
import { Attempts } from "../attempt.ts";
import { InMemoryAllowance } from "../payments.ts";
import { usdc } from "../money.ts";
import { PRICE } from "../pricing.ts";

/** Every arrangement of the items, so a claim about all of them can be checked on all of them. */
function permutations(items: readonly string[]): string[] {
  if (items.length <= 1) return [items.join("")];
  return items.flatMap((x, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => x + rest));
}

/** Jacobsthal numbers from the third on, 3, 5, 11, 21, which fix merge insertion's order of work. */
const jacobsthal = (k: number) => (2 ** (k + 1) + (k % 2 === 0 ? 1 : -1)) / 3;

/**
 * Ford and Johnson's merge insertion, as a reference solver. Sorts worst first.
 *
 * Pair the items and compare each pair. Sort the winners the same way. The loser paired with the
 * lowest winner goes in front for free, since it is below something already known to be lowest.
 * The other losers are then inserted by binary search, in the order the Jacobsthal numbers give,
 * which keeps every search inside a stretch one short of a power of two, where binary insertion
 * wastes nothing. No sort of eight items can guarantee fewer comparisons.
 */
async function mergeInsertion(xs: readonly string[], below: (a: string, b: string) => Promise<boolean>): Promise<string[]> {
  if (xs.length <= 1) return [...xs];
  const loserOf = new Map<string, string>();
  const winners: string[] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const [lo, hi] = (await below(xs[i]!, xs[i + 1]!)) ? [xs[i]!, xs[i + 1]!] : [xs[i + 1]!, xs[i]!];
    loserOf.set(hi, lo);
    winners.push(hi);
  }
  const straggler = xs.length % 2 === 1 ? xs[xs.length - 1]! : null;

  const sorted = await mergeInsertion(winners, below);
  const chain = [loserOf.get(sorted[0]!)!, ...sorted];
  const pending = sorted.slice(1).map((w) => ({ item: loserOf.get(w)!, bound: w as string | null }));
  if (straggler !== null) pending.push({ item: straggler, bound: null });

  // pending[j] is the loser numbered j + 2 in the usual telling; groups run from t_k down to t_(k-1) + 1.
  const order: number[] = [];
  for (let k = 2, prev = 1; order.length < pending.length; k++) {
    const t = jacobsthal(k);
    for (let n = Math.min(t, pending.length + 1); n > prev; n--) order.push(n - 2);
    prev = t;
  }
  for (const j of order) {
    const { item, bound } = pending[j]!;
    let lo = 0, hi = bound === null ? chain.length : chain.indexOf(bound);
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (await below(item, chain[mid]!)) hi = mid; else lo = mid + 1;
    }
    chain.splice(lo, 0, item);
  }
  return chain;
}

/** Sorts through `judge`, which names the better of two, and reports best first. */
async function solve(judge: (a: string, b: string) => Promise<string>): Promise<{ order: string; asked: number }> {
  let asked = 0;
  const below = async (a: string, b: string) => { asked++; return (await judge(a, b)) === b; };
  const worstFirst = await mergeInsertion([...ITEMS], below);
  return { order: worstFirst.reverse().join(""), asked };
}

describe("the order comes from the seed alone", () => {
  test("the same seed gives the same order, every item once", () => {
    expect(orderFrom("7")).toBe(orderFrom("7"));
    expect(parseOrder(orderFrom("7"))).toBe(orderFrom("7"));
  });
  test("seeds reach many orders", () => {
    expect(new Set(Array.from({ length: 300 }, (_, i) => orderFrom(`r-${i}`))).size).toBeGreaterThan(290);
  });
});

describe("the problem, through its interface", () => {
  const seed = "4242";
  test("a comparison names the better of the two, in either order and any case", () => {
    const order = orderFrom(seed);
    const [best, worst] = [order[0]!, order[7]!];
    for (const pair of [[worst.toLowerCase(), best], [best, worst.toLowerCase()]]) {
      expect(ranking.probe(seed, pair, null)!.answer).toMatchObject({ better: best });
    }
  });
  test("malformed comparisons are refused, and so are not charged", () => {
    for (const bad of [null, "AB", ["A"], ["A", "A"], ["A", "Z"], ["A", "B", "C"], [1, 2], { a: "A", b: "B" }]) {
      expect(ranking.probe(seed, bad, null)).toBeNull();
    }
  });
  test("the checker wants the whole order, best first", () => {
    const order = orderFrom(seed);
    expect(ranking.check(seed, order)).toBe(true);
    expect(ranking.check(seed, [...order])).toBe(true);
    expect(ranking.check(seed, [...order].reverse().join(""))).toBe(false);
    expect(ranking.check(seed, order[1]! + order[0]! + order.slice(2))).toBe(false);
    expect(ranking.check(seed, order.slice(0, 7))).toBe(false);
    expect(ranking.check(seed, order.slice(0, 7) + order[0])).toBe(false);
  });
});

describe("par is sixteen, and it is met", () => {
  test("no method can promise fewer: fifteen answers tell apart at most 32,768 of 40,320 orders", () => {
    expect(ORDERS).toBe(40_320);
    expect(2 ** 15).toBeLessThan(ORDERS);
    expect(2 ** 16).toBeGreaterThanOrEqual(ORDERS);
  });

  test("merge insertion sorts every one of the 40,320 orders in sixteen comparisons or fewer", async () => {
    let worst = 0;
    for (const order of permutations([...ITEMS])) {
      const out = await solve(async (a, b) => better(order, a, b));
      expect(out.order).toBe(order);
      worst = Math.max(worst, out.asked);
    }
    expect(worst).toBe(ranking.par!);
  });
});

describe("a run, end to end", () => {
  test("solved through the lifecycle, and it cost what it asked", async () => {
    const money = new InMemoryAllowance();
    money.grant("agent:judge", usdc("5"));
    const attempts = new Attempts(money);
    const a = attempts.start("agent:judge", "ranking", "4242")!;
    const out = await solve(async (x, y) =>
      ((await attempts.ask(a.id, [x, y])) as { answer: { better: string } }).answer.better);
    expect((await attempts.submit(a.id, out.order) as { solved: boolean }).solved).toBe(true);
    expect(attempts.get(a.id)!.spend).toBe(PRICE.ask * BigInt(out.asked));
    expect(out.asked).toBeLessThanOrEqual(ranking.par!);
  });
});
