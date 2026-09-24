import { stream, type Seed } from "./seed.ts";
import { GENERATOR, register, type Problem } from "./problem.ts";

/**
 * Zendo: a hidden rule, learned by proposing examples.
 *
 * You may ask whether any triple satisfies the rule, and each question costs. Then you classify a
 * published set of twenty triples, and you are right only if all twenty are.
 *
 * **The test set is public on purpose.** You are allowed to simply buy the answer — probe all twenty
 * and read them off. It costs $0.40. Working the rule out from four well-chosen probes costs a
 * fifth of that. So the puzzle is not "can you find the rule" but "can you find it for less than
 * the price of not bothering", which is the same decision the maze asked once and this one asks
 * every round.
 *
 * Compute is no help. The space of rules is small and the space of triples is large; what separates
 * a good agent from a brute-forcing one is which four triples it chooses to buy.
 */

export type Triple = readonly [number, number, number];

interface Rule {
  readonly name: string;
  readonly holds: (t: Triple) => boolean;
}

/**
 * The families. Deliberately overlapping — `2,4,6` satisfies half of them, so a first probe that
 * comes back true has told you almost nothing, which is the trap Wason's original task set.
 */
const RULES: Rule[] = [
  { name: "strictly ascending", holds: ([a, b, c]) => a < b && b < c },
  { name: "all even", holds: (t) => t.every((n) => n % 2 === 0) },
  { name: "sum divisible by three", holds: ([a, b, c]) => (a + b + c) % 3 === 0 },
  { name: "equally spaced", holds: ([a, b, c]) => b - a === c - b },
  { name: "all the same parity", holds: ([a, b, c]) => a % 2 === b % 2 && b % 2 === c % 2 },
  { name: "the third is the sum of the first two", holds: ([a, b, c]) => a + b === c },
  { name: "strictly descending", holds: ([a, b, c]) => a > b && b > c },
  { name: "contains a multiple of five", holds: (t) => t.some((n) => n !== 0 && n % 5 === 0) },
  { name: "sums to less than thirty", holds: ([a, b, c]) => a + b + c < 30 },
  { name: "all distinct", holds: ([a, b, c]) => a !== b && b !== c && a !== c },
];

export const TEST_SIZE = 20;

export function ruleFor(seed: Seed): Rule {
  return RULES[Math.floor(stream(seed, "zendo/rule")() * RULES.length)]!;
}

/**
 * The twenty triples to classify.
 *
 * Built to be mixed: a run of all-true or all-false answers would let an agent pass by guessing one
 * of two constants, so the set is resampled until both classes are well represented.
 */
export function testSet(seed: Seed): Triple[] {
  const rule = ruleFor(seed);
  const next = stream(seed, "zendo/triples");
  const draw = (): Triple =>
    [Math.floor(next() * 20), Math.floor(next() * 20), Math.floor(next() * 20)] as Triple;

  const yes: Triple[] = [];
  const no: Triple[] = [];
  for (let i = 0; i < 20_000 && (yes.length < TEST_SIZE / 2 || no.length < TEST_SIZE / 2); i++) {
    const t = draw();
    (rule.holds(t) ? yes : no).push(t);
  }
  const mixed = [...yes.slice(0, TEST_SIZE / 2), ...no.slice(0, TEST_SIZE / 2)];
  // Shuffle deterministically, so position carries no information.
  const shuffle = stream(seed, "zendo/order");
  for (let i = mixed.length - 1; i > 0; i--) {
    const j = Math.floor(shuffle() * (i + 1));
    [mixed[i], mixed[j]] = [mixed[j]!, mixed[i]!];
  }
  return mixed;
}

const parseTriple = (q: unknown): Triple | null => {
  if (!Array.isArray(q) || q.length !== 3) return null;
  if (!q.every((n) => typeof n === "number" && Number.isInteger(n))) return null;
  return q as unknown as Triple;
};

export const zendo: Problem = register({
  id: "zendo",
  title: "Zendo",
  category: "induction",
  level: "medium",
  par: null,
  statement:
    "A rule decides whether a triple of integers belongs. Propose any triple and learn only yes or " +
    "no; each question costs. Then classify the twenty published triples, and all twenty must be right. " +
    "You may buy the answers to all twenty, and it will cost you five times what working it out does.",
  harness: (seed) => ({
    probe: "[a, b, c], three integers",
    answer: `[${TEST_SIZE} booleans, in the order of the test set]`,
    testSet: testSet(seed),
    note:
      "The test set is public. Probing all of it is allowed and expensive; the rule is cheap. " +
      "src/problems/zendo.ts holds the rule families. Read them; they are not a secret either.",
    generator: GENERATOR,
    ruleFamilies: RULES.length,
  }),
  initialState: () => null,
  probe(seed, question, state) {
    const t = parseTriple(question);
    if (!t) return null;
    return { answer: { holds: ruleFor(seed).holds(t) }, state };
  },
  check(seed, answer) {
    if (!Array.isArray(answer) || answer.length !== TEST_SIZE) return false;
    if (!answer.every((b) => typeof b === "boolean")) return false;
    const rule = ruleFor(seed);
    return testSet(seed).every((t, i) => rule.holds(t) === answer[i]);
  },
});
