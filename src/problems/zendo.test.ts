import { expect, test, describe } from "bun:test";
import { holdsAt, ruleFor, ruleNamed, ruleNames, solve, zendo, DOMAIN, type Triple } from "./zendo.ts";
import { Attempts } from "../attempt.ts";
import { InMemoryAllowance } from "../payments.ts";
import { usdc } from "../money.ts";
import { PRICE } from "../pricing.ts";

describe("the rules", () => {
  test("there are thousands, every one different on some triple", () => {
    const names = ruleNames();
    expect(names.length).toBeGreaterThan(3000);
    expect(new Set(names).size).toBe(names.length);
    // Distinct as rules, not only as names: no two agree on all 8,000 triples.
    const seen = new Set<string>();
    for (let r = 0; r < names.length; r++) {
      let key = "";
      for (let i = 0; i < DOMAIN ** 3; i += 1) {
        const t: Triple = [Math.floor(i / 400), Math.floor(i / 20) % 20, i % 20];
        key += holdsAt(r, t) ? "1" : "0";
      }
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  }, 60_000);

  test("every name is a sentence, and the lookup of a name finds its rule", () => {
    for (const [i, name] of ruleNames().entries()) {
      expect(name).toMatch(/^[a-z0-9 ,]+$/);
      expect(ruleNamed(name)).toBe(i);
    }
  });

  test("a rule's name and its bits agree", () => {
    const i = ruleNamed("the sum is divisible by 3");
    expect(holdsAt(i, [1, 1, 1])).toBe(true);
    expect(holdsAt(i, [1, 1, 2])).toBe(false);
  });
});

describe("the rule comes from the seed alone", () => {
  test("the same seed gives the same rule, and seeds reach many", () => {
    expect(ruleFor("7").name).toBe(ruleFor("7").name);
    const names = new Set(Array.from({ length: 300 }, (_, i) => ruleFor(`z-${i}`).name));
    expect(names.size).toBeGreaterThan(280);
  });
});

describe("the problem, through its interface", () => {
  const seed = "4242";
  test("a triple gets yes or no, and nothing else", () => {
    const out = zendo.probe(seed, [2, 4, 6], null)!;
    expect(out.answer).toEqual({ holds: ruleFor(seed).holds([2, 4, 6]) });
  });
  test("anything but three whole numbers from 0 to 19 is refused, and so is not charged", () => {
    for (const bad of [[1, 2], [1, 2, 3, 4], "nope", null, [1, 2, "3"], [1.5, 2, 3], {}, [1, 2, 20], [-1, 2, 3]]) {
      expect(zendo.probe(seed, bad, null)).toBeNull();
    }
  });
  test("the checker wants the rule's name, in any case and spacing, and nothing else", () => {
    const name = ruleFor(seed).name;
    expect(zendo.check(seed, name)).toBe(true);
    expect(zendo.check(seed, `  ${name.toUpperCase()} `)).toBe(true);
    const other = ruleNames().find((n) => n !== name)!;
    expect(zendo.check(seed, other)).toBe(false);
    expect(zendo.check(seed, "something else")).toBe(false);
    expect(zendo.check(seed, 3)).toBe(false);
  });
});

describe("honest play", () => {
  test("the reference solver names the rule, in around a dozen questions", async () => {
    let total = 0;
    const SEEDS = 8;
    for (let s = 0; s < SEEDS; s++) {
      const seed = `honest-${s}`;
      const rule = ruleFor(seed);
      const out = await solve(async (t) => rule.holds(t));
      expect(out.name).toBe(rule.name);
      total += out.asked;
    }
    expect(total / SEEDS).toBeLessThan(20);
  }, 60_000);

  test("a run, end to end, costs what it asked and the name solves it", async () => {
    const money = new InMemoryAllowance();
    money.grant("agent:zendo", usdc("5"));
    const attempts = new Attempts(money);
    const a = attempts.start("agent:zendo", "zendo", "4242")!;
    const out = await solve(async (t) => ((await attempts.ask(a.id, t)) as { answer: { holds: boolean } }).answer.holds);
    expect((await attempts.submit(a.id, out.name) as { solved: boolean }).solved).toBe(true);
    expect(attempts.get(a.id)!.spend).toBe(PRICE.ask * BigInt(out.asked));
  }, 60_000);
});
