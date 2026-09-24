import { register, GENERATOR, type Problem } from "./problem.ts";
import { stream, type Seed } from "./seed.ts";

/**
 * Codebreaker: a hidden code of four colours, cracked from how close each guess comes.
 *
 * The classic game. A guess is scored by how many colours are in the right place, and how many more
 * are the right colour in the wrong place, and nothing else. No single answer names the code; every
 * one only rules some codes out. It is diagnosis in miniature: each test narrows the space, and the
 * skill is choosing the test that narrows it most.
 *
 * Knuth showed in 1977 that five guesses always suffice. The fifth is the code itself, which here is
 * the free submission, so four paid guesses are enough. Three never are: every opening guess has a
 * reply that leaves more than 196 codes, a reply is one of at most fourteen scores, and two more
 * guesses cannot single out one code from that many.
 */

export const COLOURS = "ABCDEF";
export const LENGTH = 4;
/** Every code there is: six colours in four places, repeats allowed. */
export const CODES = COLOURS.length ** LENGTH;

export interface Score { readonly exact: number; readonly near: number }

export function codeFrom(seed: Seed): string {
  const next = stream(seed, "codebreaker/code");
  return Array.from({ length: LENGTH }, () => COLOURS[Math.floor(next() * COLOURS.length)]!).join("");
}

/**
 * How close a guess is: colours in the right place, then colours right but misplaced.
 *
 * `near` counts each colour at most as often as it appears in both, after the exact matches are
 * taken out. That is the rule of the physical game, and the one every published strategy assumes.
 */
export function score(code: string, guess: string): Score {
  let exact = 0;
  const codeLeft = new Map<string, number>();
  const guessLeft = new Map<string, number>();
  for (let i = 0; i < LENGTH; i++) {
    if (code[i] === guess[i]) { exact++; continue; }
    codeLeft.set(code[i]!, (codeLeft.get(code[i]!) ?? 0) + 1);
    guessLeft.set(guess[i]!, (guessLeft.get(guess[i]!) ?? 0) + 1);
  }
  let near = 0;
  for (const [colour, n] of guessLeft) near += Math.min(n, codeLeft.get(colour) ?? 0);
  return { exact, near };
}

/** A code as the agent wrote it: four letters from A to F, as a string or an array, any case. */
export function parseCode(q: unknown): string | null {
  const text = Array.isArray(q) && q.every((c) => typeof c === "string") ? q.join("") : q;
  if (typeof text !== "string") return null;
  const code = text.toUpperCase();
  if (code.length !== LENGTH || ![...code].every((c) => COLOURS.includes(c))) return null;
  return code;
}

export const codebreaker: Problem = register({
  id: "codebreaker",
  title: "Codebreaker",
  category: "hypothesis elimination",
  level: "medium",
  par: 4,
  statement:
    `A hidden code of ${LENGTH} colours, each one of ${COLOURS.split("").join(", ")}, and colours ` +
    "may repeat. Guess a code and learn how many colours are in the right place, and how many more " +
    "are the right colour in the wrong place; each guess costs. Then submit the code. Five guesses " +
    "always suffice, the last being the code itself, so four paid guesses is the best possible.",
  harness: (seed) => ({
    probe: `"ABCD", four of ${COLOURS}`,
    answer: `the code, like "FACE"`,
    colours: COLOURS, length: LENGTH, codes: CODES,
    scoring:
      "exact is colours in the right place; near is colours right but misplaced, each colour " +
      "counted at most as often as it appears in both, after the exact ones are taken out",
    note: "A code is a function of its seed, in src/problems/codebreaker.ts.",
    generator: GENERATOR,
    example: { seed, code: codeFrom(seed) },
  }),
  initialState: () => null,
  probe(seed, question, state) {
    const guess = parseCode(question);
    if (!guess) return null;
    return { answer: { guess, ...score(codeFrom(seed), guess) }, state };
  },
  check(seed, answer) {
    return parseCode(answer) === codeFrom(seed);
  },
});
