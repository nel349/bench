import { register, GENERATOR, type Problem } from "./problem.ts";
import { stream, type Seed } from "./seed.ts";

/**
 * Liar: find a hidden number when one of the answers you are given is false.
 *
 * Ask whether the number is in any set you like and get yes or no. One answer among the first
 * sixteen is a lie, and nothing marks which. Plain binary search trusts every answer and so finds
 * the wrong number; an agent has to buy enough redundancy to survive one bad answer, and no more.
 * That is the job of working with a tool that is sometimes wrong.
 *
 * This is Ulam's searching game, and its cost is known. Each question at best halves what is still
 * possible, where a number counts once for every way it could still be the answer, lie included:
 * with q questions left, a number no answer has contradicted can still be reached q + 1 ways. So
 * 1,024 numbers need q with 2^q >= 1,024 x (q + 1), which is fourteen, and Pelc proved in 1987 that
 * the bound is met.
 *
 * The first problem here with state: the answer to a question depends on how many came before it,
 * so the count lives on the run and is replayed in order by anyone checking it.
 */

export const NUMBERS = 1024;
/** The lie falls somewhere in the first this-many answers. */
export const LIE_WINDOW = 16;

export interface Secret {
  readonly number: number;
  /** Which answer is false, counting from zero. */
  readonly lieAt: number;
}

export function secretFrom(seed: Seed): Secret {
  const next = stream(seed, "liar/secret");
  return { number: Math.floor(next() * NUMBERS), lieAt: Math.floor(next() * LIE_WINDOW) };
}

/** A question: inclusive ranges whose union is the set being asked about. */
export type Ranges = readonly (readonly [number, number])[];

const isNumber = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n < NUMBERS;

export function parseRanges(q: unknown): Ranges | null {
  if (typeof q !== "object" || q === null) return null;
  const ranges = (q as { in?: unknown }).in;
  if (!Array.isArray(ranges) || ranges.length === 0 || ranges.length > NUMBERS) return null;
  const out: [number, number][] = [];
  for (const r of ranges) {
    if (!Array.isArray(r) || r.length !== 2 || !isNumber(r[0]) || !isNumber(r[1]) || r[0] > r[1]) return null;
    out.push([r[0], r[1]]);
  }
  return out;
}

export const within = (n: number, ranges: Ranges): boolean => ranges.some(([lo, hi]) => n >= lo && n <= hi);

/** The answer to the `asked`-th question, counting from zero: the truth, except once. */
export function answer(s: Secret, ranges: Ranges, asked: number): boolean {
  const truth = within(s.number, ranges);
  return asked === s.lieAt ? !truth : truth;
}

const asked = (state: unknown): number => (typeof state === "number" ? state : 0);

export const liar: Problem = register({
  id: "liar",
  title: "Liar",
  category: "search with a false answer",
  level: "hard",
  par: 14,
  statement:
    `A hidden number from 0 to ${NUMBERS - 1}. Ask whether it is in any set of numbers you choose, ` +
    `written as ranges, and learn yes or no; each question costs. Exactly one of the first ` +
    `${LIE_WINDOW} answers is a lie, and nothing says which. Name the number. Fourteen questions ` +
    "are always enough, and no method can promise fewer.",
  harness: (seed) => ({
    probe: '{ "in": [[0, 511]] }, or several ranges: { "in": [[0, 9], [100, 199]] }',
    answer: "the number",
    numbers: NUMBERS, lieWindow: LIE_WINDOW,
    note:
      "The number and which answer is the lie are a function of the seed, in src/problems/liar.ts. " +
      "The answer to a question depends on how many were asked before it, so replay a run in order.",
    generator: GENERATOR,
    example: { seed, ...secretFrom(seed) },
  }),
  initialState: () => 0,
  probe(seed, question, state) {
    const ranges = parseRanges(question);
    if (!ranges) return null;
    const n = asked(state);
    return { answer: { yes: answer(secretFrom(seed), ranges, n) }, state: n + 1 };
  },
  check(seed, submitted) {
    return isNumber(submitted) && submitted === secretFrom(seed).number;
  },
});
