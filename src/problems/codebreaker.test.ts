import { expect, test, describe } from "bun:test";
import { codeFrom, codebreaker, parseCode, score, CODES, COLOURS, LENGTH } from "./codebreaker.ts";
import { Attempts } from "../attempt.ts";
import { InMemoryAllowance } from "../payments.ts";
import { usdc } from "../money.ts";
import { PRICE } from "../pricing.ts";

/** Every code, in order. */
const ALL: readonly string[] = Array.from({ length: CODES }, (_, i) =>
  Array.from({ length: LENGTH }, (_, p) => COLOURS[Math.floor(i / COLOURS.length ** (LENGTH - 1 - p)) % COLOURS.length]).join(""));

const key = (s: { exact: number; near: number }) => `${s.exact}/${s.near}`;

/**
 * Knuth's minimax strategy, as a reference solver.
 *
 * Open with AABB. After each score, keep the codes that would have scored the same, and guess the
 * code, from all of them, whose worst-case reply leaves the fewest behind: a code still possible
 * first, then the earliest. The choice depends only on the scores so far, so it is memoised on them,
 * which is what makes playing it against every code affordable.
 */
const nextGuess = new Map<string, string>();
function knuth(candidates: readonly string[], history: string): string {
  if (history === "") return "AABB";
  const known = nextGuess.get(history);
  if (known !== undefined) return known;
  const possible = new Set(candidates);
  let best = { guess: "", worst: Infinity, possible: false };
  for (const guess of ALL) {
    const parts = new Map<string, number>();
    for (const c of candidates) parts.set(key(score(c, guess)), (parts.get(key(score(c, guess))) ?? 0) + 1);
    const worst = Math.max(...parts.values());
    const better = worst < best.worst || (worst === best.worst && possible.has(guess) && !best.possible);
    if (better) best = { guess, worst, possible: possible.has(guess) };
  }
  nextGuess.set(history, best.guess);
  return best.guess;
}

/** Plays Knuth through `ask`, and stops paying the moment only one code is left. */
async function solve(ask: (guess: string) => Promise<{ exact: number; near: number }>): Promise<{ code: string; asked: number }> {
  let candidates = ALL;
  let history = "";
  let asked = 0;
  while (candidates.length > 1) {
    const guess = knuth(candidates, history);
    const s = await ask(guess);
    asked++;
    if (s.exact === LENGTH) return { code: guess, asked };
    candidates = candidates.filter((c) => key(score(c, guess)) === key(s));
    history += `${guess}:${key(s)};`;
  }
  return { code: candidates[0]!, asked };
}

describe("scoring is the physical game's", () => {
  test("exact before near, and a colour is counted no more often than it appears in both", () => {
    expect(score("AABB", "AABB")).toEqual({ exact: 4, near: 0 });
    expect(score("ABCD", "DCBA")).toEqual({ exact: 0, near: 4 });
    expect(score("AABB", "ABAB")).toEqual({ exact: 2, near: 2 });
    expect(score("AAAB", "ABBB")).toEqual({ exact: 2, near: 0 });
    expect(score("ABCD", "AAAA")).toEqual({ exact: 1, near: 0 });
    expect(score("FEDC", "ABAB")).toEqual({ exact: 0, near: 0 });
  });
  test("it is symmetric, as it must be for the strategy to hold", () => {
    for (let i = 0; i < 400; i++) {
      const a = ALL[(i * 37) % CODES]!, b = ALL[(i * 101 + 7) % CODES]!;
      expect(score(a, b)).toEqual(score(b, a));
    }
  });
});

describe("the code comes from the seed alone", () => {
  test("the same seed gives the same code, and seeds reach many codes", () => {
    expect(codeFrom("7")).toBe(codeFrom("7"));
    const codes = new Set(Array.from({ length: 400 }, (_, i) => codeFrom(`cb-${i}`)));
    expect(codes.size).toBeGreaterThan(300);
    for (const c of codes) expect(parseCode(c)).toBe(c);
  });
});

describe("the problem, through its interface", () => {
  const seed = "4242";
  test("a guess is scored against the hidden code, in any case and either shape", () => {
    const out = codebreaker.probe(seed, "abcd", null)!;
    expect(out.answer).toEqual({ guess: "ABCD", ...score(codeFrom(seed), "ABCD") });
    expect(codebreaker.probe(seed, ["A", "B", "C", "D"], null)!.answer).toEqual(out.answer);
  });
  test("malformed guesses are refused, and so are not charged", () => {
    for (const bad of [null, 5, "ABC", "ABCDE", "ABCG", ["A", "B", "C"], [1, 2, 3, 4], {}]) {
      expect(codebreaker.probe(seed, bad, null)).toBeNull();
    }
  });
  test("the checker wants the code", () => {
    const code = codeFrom(seed);
    expect(codebreaker.check(seed, code)).toBe(true);
    expect(codebreaker.check(seed, code.toLowerCase())).toBe(true);
    const wrong = (code[0] === "A" ? "B" : "A") + code.slice(1);
    expect(codebreaker.check(seed, wrong)).toBe(false);
    expect(codebreaker.check(seed, "ABCDE")).toBe(false);
  });
});

describe("par is four paid guesses, and it is met", () => {
  /**
   * Why three can never be enough. A reply is one of at most fourteen scores. Every opening leaves
   * some reply with more than 14 x 14 codes behind it, so after a second guess some reply still
   * leaves more than fourteen, and a third guess cannot split more than fourteen into ones.
   */
  test("no method can promise three: every opening leaves more than 196 codes on some reply", () => {
    const outcomes = new Set(ALL.map((c) => key(score(c, "ABCD"))).concat(ALL.map((c) => key(score(c, "AABB")))));
    expect(outcomes.size).toBeLessThanOrEqual(14);
    for (const opening of ALL) {
      const parts = new Map<string, number>();
      for (const c of ALL) parts.set(key(score(c, opening)), (parts.get(key(score(c, opening))) ?? 0) + 1);
      expect(Math.max(...parts.values())).toBeGreaterThan(14 * 14);
    }
  });

  test("Knuth's strategy knows every one of the 1,296 codes within four", async () => {
    let worst = 0;
    for (const code of ALL) {
      const out = await solve(async (g) => score(code, g));
      expect(out.code).toBe(code);
      worst = Math.max(worst, out.asked);
    }
    expect(worst).toBe(codebreaker.par!);
  });
});

describe("a run, end to end", () => {
  test("solved through the lifecycle for the probes it asked, and the submission free", async () => {
    const money = new InMemoryAllowance();
    money.grant("agent:knuth", usdc("5"));
    const attempts = new Attempts(money);
    const a = attempts.start("agent:knuth", "codebreaker", "4242")!;
    const out = await solve(async (g) =>
      ((await attempts.ask(a.id, g)) as { answer: { exact: number; near: number } }).answer);
    expect((await attempts.submit(a.id, out.code) as { solved: boolean }).solved).toBe(true);
    expect(attempts.get(a.id)!.spend).toBe(PRICE.ask * BigInt(out.asked));
  });
});
