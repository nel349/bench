import { expect, test, describe } from "bun:test";
import { answer, liar, secretFrom, within, LIE_WINDOW, NUMBERS, type Ranges } from "./liar.ts";
import { Attempts } from "../attempt.ts";
import { InMemoryAllowance } from "../payments.ts";
import { usdc } from "../money.ts";
import { PRICE } from "../pricing.ts";

const SEEDS = Array.from({ length: 300 }, (_, i) => `liar-${i}`);

/** Consecutive numbers folded into ranges, which is how a question is written. */
function toRanges(numbers: readonly number[]): Ranges {
  const sorted = [...numbers].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && last[1] === n - 1) last[1] = n; else out.push([n, n]);
  }
  return out;
}

/** Below this many live numbers, positions are searched exactly rather than trusted to the bound. */
const EXACT_BELOW = 48;

/**
 * Whether a position can still be won: `clean` numbers no answer has contradicted, `once` numbers
 * one answer has, and `left` questions to go.
 *
 * The volume bound says a position weighing more than 2^left cannot be won. It does not say every
 * position under it can: three clean numbers with four questions left weigh fifteen, under sixteen,
 * and no question splits them so that both answers stay winnable. So small positions are searched.
 */
const memo = new Map<string, boolean>();
function winnable(clean: number, once: number, left: number): boolean {
  if (clean + once <= 1) return true;
  if (left === 0 || clean * (left + 1) + once > 2 ** left) return false;
  if (clean + once >= EXACT_BELOW) return true;
  const key = `${clean},${once},${left}`;
  const known = memo.get(key);
  if (known !== undefined) return known;
  let found = false;
  for (let a0 = 0; a0 <= clean && !found; a0++) {
    for (let a1 = 0; a1 <= once && !found; a1++) {
      found = winnable(a0, a1 + clean - a0, left - 1) && winnable(clean - a0, once - a1 + a0, left - 1);
    }
  }
  memo.set(key, found);
  return found;
}

/**
 * The next question, as how many clean and how many once-contradicted numbers to ask about.
 *
 * Berlekamp's volume strategy with the endgame searched. With q questions left a clean number can
 * still be reached q + 1 ways and a once-contradicted one exactly once, and a question can at best
 * halve that total. This splits it as evenly as it can among the splits that leave both answers
 * winnable. Clean numbers are interchangeable, and so are once-contradicted ones, so the counts are
 * the whole position.
 */
function split(clean: number, once: number, left: number): { readonly a0: number; readonly a1: number } {
  let best = { a0: 0, a1: 0, worst: Infinity };
  for (let a0 = 0; a0 <= clean; a0++) {
    // One answer's weight rises with a1 and the other's falls, so only the middle is worth trying,
    // except in the endgame, where everything is.
    const middle = Math.floor(((clean - a0) * (left - 1) + once - a0 * (left - 1)) / 2);
    const tries = clean + once < EXACT_BELOW
      ? Array.from({ length: once + 1 }, (_, i) => i)
      : [middle - 1, middle, middle + 1];
    for (const t of tries) {
      const a1 = Math.max(0, Math.min(once, t));
      const yes = [a0, a1 + clean - a0] as const;
      const no = [clean - a0, once - a1 + a0] as const;
      if (!winnable(...yes, left - 1) || !winnable(...no, left - 1)) continue;
      const worst = Math.max(yes[0] * left + yes[1], no[0] * left + no[1]);
      if (worst < best.worst) best = { a0, a1, worst };
    }
  }
  if (best.worst === Infinity) throw new Error(`no winnable question from ${clean}, ${once} with ${left} left`);
  return best;
}

/** Plays `split` against the real problem, through whatever `ask` charges. */
async function solve(ask: (r: Ranges) => Promise<boolean>): Promise<{ number: number | null; asked: number }> {
  const lies = new Array<number>(NUMBERS).fill(0);
  let asked = 0;
  for (let left = liar.par!; left > 0; left--) {
    const clean = lies.flatMap((e, n) => (e === 0 ? [n] : []));
    const once = lies.flatMap((e, n) => (e === 1 ? [n] : []));
    if (clean.length + once.length <= 1) break;
    const { a0, a1 } = split(clean.length, once.length, left);
    const set = [...clean.slice(0, a0), ...once.slice(0, a1)];
    const inSet = new Set(set);
    const yes = await ask(toRanges(set));
    asked++;
    for (let n = 0; n < NUMBERS; n++) if (inSet.has(n) !== yes) lies[n]!++;
  }
  const alive = lies.flatMap((e, n) => (e <= 1 ? [n] : []));
  return { number: alive.length === 1 ? alive[0]! : null, asked };
}

describe("the secret comes from the seed alone", () => {
  test("the same seed gives the same number and the same lie", () => {
    expect(secretFrom("7")).toEqual(secretFrom("7"));
  });
  test("numbers and lie positions cover their ranges", () => {
    const numbers = new Set(SEEDS.map((s) => secretFrom(s).number));
    const lies = new Set(SEEDS.map((s) => secretFrom(s).lieAt));
    expect(numbers.size).toBeGreaterThan(200);
    expect([...lies].sort((a, b) => a - b)).toEqual(Array.from({ length: LIE_WINDOW }, (_, i) => i));
  });
});

describe("answers", () => {
  const s = { number: 300, lieAt: 2 };
  test("tell the truth, except the one that is the lie", () => {
    expect(answer(s, [[0, 511]], 0)).toBe(true);
    expect(answer(s, [[0, 511]], 1)).toBe(true);
    expect(answer(s, [[0, 511]], 2)).toBe(false);   // the lie
    expect(answer(s, [[0, 511]], 3)).toBe(true);
  });
  test("a set of several ranges is their union", () => {
    expect(within(300, [[0, 9], [290, 310]])).toBe(true);
    expect(within(300, [[0, 9], [301, 310]])).toBe(false);
  });
});

describe("the problem, through its interface", () => {
  const seed = "4242";
  test("the count of questions is the state, and it is what places the lie", () => {
    const { lieAt, number } = secretFrom(seed);
    let state: unknown = liar.initialState(seed);
    const all: [number, number][] = [[0, NUMBERS - 1]];
    for (let i = 0; i < LIE_WINDOW; i++) {
      const out = liar.probe(seed, { in: all }, state)!;
      expect((out.answer as { yes: boolean }).yes).toBe(i !== lieAt);
      expect(out.state).toBe(i + 1);
      state = out.state;
    }
    expect(liar.check(seed, number)).toBe(true);
  });

  test("malformed questions are refused, and so are not charged", () => {
    for (const bad of [null, 5, {}, { in: [] }, { in: [[5, 4]] }, { in: [[0, NUMBERS]] }, { in: [[-1, 3]] },
      { in: [[1.5, 3]] }, { in: [[1]] }, { in: "0-511" }]) {
      expect(liar.probe(seed, bad, 0)).toBeNull();
    }
  });

  test("the checker wants the number, exactly", () => {
    const { number } = secretFrom(seed);
    expect(liar.check(seed, number)).toBe(true);
    expect(liar.check(seed, (number + 1) % NUMBERS)).toBe(false);
    expect(liar.check(seed, String(number))).toBe(false);
  });
});

describe("par is fourteen, and it is met", () => {
  test("thirteen cannot be enough: 1,024 numbers weigh more than thirteen questions can halve", () => {
    expect(NUMBERS * (13 + 1)).toBeGreaterThan(2 ** 13);
    expect(NUMBERS * (14 + 1)).toBeLessThanOrEqual(2 ** 14);
  });

  /**
   * The strategy followed down both answers of every question, from the start, fourteen deep. Any
   * run the problem can produce, with the lie anywhere or nowhere, is one path through this tree,
   * so every leaf ending on a single number is the par proven for this solver, not sampled.
   */
  test("the strategy wins against every sequence of answers with at most one lie", () => {
    const seen = new Map<string, boolean>();
    const wins = (clean: number, once: number, left: number): boolean => {
      if (clean + once <= 1) return true;
      if (left === 0) return false;
      const key = `${clean},${once},${left}`;
      const known = seen.get(key);
      if (known !== undefined) return known;
      const { a0, a1 } = split(clean, once, left);
      const won = wins(a0, a1 + clean - a0, left - 1) && wins(clean - a0, once - a1 + a0, left - 1);
      seen.set(key, won);
      return won;
    };
    expect(wins(NUMBERS, 0, liar.par!)).toBe(true);
  });

  test("the volume strategy finds every number in fourteen questions, lie and all", async () => {
    for (const seed of SEEDS) {
      const s = secretFrom(seed);
      let n = 0;
      const out = await solve(async (r) => answer(s, r, n++));
      expect(out.asked).toBeLessThanOrEqual(liar.par!);
      expect(out.number).toBe(s.number);
    }
  });

  test("trusting every answer is caught by the lie", () => {
    // Plain binary search: ten questions, no redundancy, wrong whenever the lie lands inside them.
    let wrong = 0;
    for (const seed of SEEDS) {
      const s = secretFrom(seed);
      let lo = 0, hi = NUMBERS - 1, asked = 0;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (answer(s, [[lo, mid]], asked++)) hi = mid; else lo = mid + 1;
      }
      if (lo !== s.number) wrong++;
    }
    expect(wrong).toBeGreaterThan(SEEDS.length / 2);
  });
});

describe("a run, end to end", () => {
  test("the state survives between paid questions, and the solver's answer is accepted", async () => {
    const money = new InMemoryAllowance();
    money.grant("agent:ulam", usdc("5"));
    const attempts = new Attempts(money);
    const a = attempts.start("agent:ulam", "liar", "4242")!;

    const out = await solve(async (r) =>
      ((await attempts.ask(a.id, { in: r })) as { answer: { yes: boolean } }).answer.yes);

    expect((await attempts.submit(a.id, out.number) as { solved: boolean }).solved).toBe(true);
    const done = attempts.get(a.id)!;
    expect(done.state).toBe(out.asked);
    expect(done.spend).toBe(PRICE.ask * BigInt(out.asked));
    expect(out.asked).toBeLessThanOrEqual(liar.par!);
  });
});
