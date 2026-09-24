import { expect, test, describe } from "bun:test";
import { ruleFor, testSet, zendo, TEST_SIZE, type Triple } from "./zendo.ts";
import { Attempts } from "../attempt.ts";
import { InMemoryAllowance } from "../payments.ts";
import { usdc, format } from "../money.ts";
import { PRICE } from "../pricing.ts";

const truthFor = (seed: string): boolean[] => testSet(seed).map((t) => ruleFor(seed).holds(t));

describe("the rule and the test set come from the seed alone", () => {
  test("the same seed gives the same rule", () => {
    for (const s of ["1", "7", "99", "4242"]) expect(ruleFor(s).name).toBe(ruleFor(s).name);
  });
  test("seeds reach more than one rule", () => {
    const names = new Set(Array.from({ length: 200 }, (_, i) => ruleFor(String(i)).name));
    expect(names.size).toBeGreaterThan(4);
  });
  test("a test set is the same every time it is asked for", () => {
    expect(testSet("4242")).toEqual(testSet("4242"));
  });
});

describe("the test set cannot be passed by guessing", () => {
  for (const seed of ["1", "7", "42", "99", "4242", "123456"]) {
    test(`seed ${seed}: ten true and ten false, so neither constant passes`, () => {
      const ts = testSet(seed);
      expect(ts).toHaveLength(TEST_SIZE);
      const yes = ts.filter((t) => ruleFor(seed).holds(t)).length;
      expect(yes).toBe(TEST_SIZE / 2);
      expect(zendo.check(seed, Array(TEST_SIZE).fill(true))).toBe(false);
      expect(zendo.check(seed, Array(TEST_SIZE).fill(false))).toBe(false);
    });
  }
});

describe("grading", () => {
  const seed = "4242";
  test("the honest answer passes", () => expect(zendo.check(seed, truthFor(seed))).toBe(true));
  test("one wrong out of twenty fails — all twenty must be right", () => {
    const nearly = truthFor(seed).map((b, i) => (i === 7 ? !b : b));
    expect(zendo.check(seed, nearly)).toBe(false);
  });
  test("a short answer, a long one, or the wrong type all fail", () => {
    expect(zendo.check(seed, truthFor(seed).slice(0, 19))).toBe(false);
    expect(zendo.check(seed, [...truthFor(seed), true])).toBe(false);
    expect(zendo.check(seed, "yes")).toBe(false);
    expect(zendo.check(seed, truthFor(seed).map(String))).toBe(false);
  });
});

describe("probing", () => {
  const seed = "4242";
  test("a triple gets a yes or a no and nothing else", () => {
    const out = zendo.probe(seed, [2, 4, 6], null);
    expect(out).not.toBeNull();
    expect(out!.answer).toEqual({ holds: ruleFor(seed).holds([2, 4, 6] as Triple) });
  });
  test("anything that is not three integers does not parse, and so is not charged for", () => {
    for (const bad of [[1, 2], [1, 2, 3, 4], "nope", null, [1, 2, "3"], [1.5, 2, 3], {}]) {
      expect(zendo.probe(seed, bad, null)).toBeNull();
    }
  });
});

/**
 * The property the problem is actually built around.
 *
 * Buying the answer is allowed. It is just dearer than thinking, and by a margin big enough that an
 * agent notices — which is the whole thesis of the gym expressed as one assertion.
 */
describe("buying the answer costs five times what working it out does", () => {
  test("probing the whole test set costs $0.40", async () => {
    const money = new InMemoryAllowance();
    money.grant("agent:brute", usdc("5"));
    const attempts = new Attempts(money);
    const a = attempts.start("agent:brute", "zendo", "4242")!;

    for (const t of testSet("4242")) await attempts.ask(a.id, t);
    const answer = a.probes.map((p) => (p.answer as { holds: boolean }).holds);
    await attempts.submit(a.id, answer);

    const done = attempts.get(a.id)!;
    expect(done.outcome).toBe("solved");
    expect(format(done.spend)).toBe("0.400000");   // 20 probes, first submission free
  });

  test("four probes and a rule costs $0.08", async () => {
    const money = new InMemoryAllowance();
    money.grant("agent:thinker", usdc("5"));
    const attempts = new Attempts(money);
    const a = attempts.start("agent:thinker", "zendo", "4242")!;

    for (const t of [[1, 2, 3], [2, 4, 6], [10, 10, 10], [9, 8, 7]]) await attempts.ask(a.id, t);
    await attempts.submit(a.id, truthFor("4242"));

    const done = attempts.get(a.id)!;
    expect(done.outcome).toBe("solved");
    expect(format(done.spend)).toBe("0.080000");
    expect(done.spend * 5n).toBe(PRICE.ask * 20n);  // exactly a fifth of buying it outright
  });
});
