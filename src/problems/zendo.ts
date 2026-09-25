import { stream, type Seed } from "./seed.ts";
import { GENERATOR, register, type Problem } from "./problem.ts";

/**
 * Zendo: a hidden rule, found by proposing examples, and then named.
 *
 * You may ask whether any triple of numbers from 0 to 19 satisfies the rule, and each question costs.
 * Then you name the rule, from the list the harness publishes. That is the real game: in Zendo the
 * student states the rule, and a teacher only ever says yes or no.
 *
 * **It used to publish twenty triples and ask for their classification.** Those triples were drawn
 * from the hidden rule, so they were evidence about it, and with only ten public rules a blind guess
 * won about one time in ten. More rules did not help while the triples were published: with 4,638 the
 * best guesser, working only from the free triples and the source, still won one time in six.
 * `FINDINGS.md` 27 in the plans repository has the measurements. Now nothing about the rule is
 * published but the candidates, so a guess wins one time in however many there are.
 *
 * The rules are simple ones and pairs of them. The skill is choosing the triple that splits what is
 * still possible most evenly; asking whatever comes to mind costs several times as much.
 */

export type Triple = readonly [number, number, number];

/** The numbers the rules are defined over, and the only numbers a probe may use: 0 to 19. */
export const DOMAIN = 20;
const CELLS = DOMAIN ** 3;
const WORDS = Math.ceil(CELLS / 32);
/** A rule that is yes, or no, for nearly every triple is not worth hiding. */
const RARE = 0.05;

export interface Rule {
  readonly name: string;
  readonly holds: (t: Triple) => boolean;
}

interface Built extends Rule {
  /** Which of the 8,000 triples it holds for, one bit each. Two rules are the same rule when these match. */
  readonly bits: Uint32Array;
}

const sum = ([a, b, c]: Triple) => a + b + c;
const evens = (t: Triple) => t.filter((n) => n % 2 === 0).length;

/**
 * The simple rules: families, each with a range of parameters. Every name is a sentence a person
 * could say, because the answer is the name.
 */
function simpleRules(): Rule[] {
  const out: Rule[] = [];
  const add = (name: string, holds: (t: Triple) => boolean) => out.push({ name, holds });
  for (let k = 2; k <= 7; k++) add(`the sum is divisible by ${k}`, (t) => sum(t) % k === 0);
  for (let x = 5; x <= 16; x++) add(`every number is below ${x}`, (t) => t.every((n) => n < x));
  for (let x = 3; x <= 14; x++) add(`every number is at least ${x}`, (t) => t.every((n) => n >= x));
  for (let s = 15; s <= 45; s += 3) add(`the sum is below ${s}`, (t) => sum(t) < s);
  for (let d = 2; d <= 14; d++) add(`the largest and smallest are at most ${d} apart`, (t) => Math.max(...t) - Math.min(...t) <= d);
  for (let n = 0; n < DOMAIN; n++) add(`it contains ${n}`, (t) => t.includes(n));
  for (let e = 0; e <= 3; e++) add(`exactly ${e} of the numbers are even`, (t) => evens(t) === e);
  for (let k = 2; k <= 4; k++) add(`every number is divisible by ${k}`, (t) => t.every((n) => n % k === 0));
  for (let k = 3; k <= 7; k++) add(`it contains a nonzero multiple of ${k}`, (t) => t.some((n) => n !== 0 && n % k === 0));
  add("the numbers rise from first to last", ([a, b, c]) => a < b && b < c);
  add("the numbers fall from first to last", ([a, b, c]) => a > b && b > c);
  add("the first is below the last", ([a, , c]) => a < c);
  add("the middle one is the largest", ([a, b, c]) => b > a && b > c);
  add("the middle one is the smallest", ([a, b, c]) => b < a && b < c);
  add("all three are different", ([a, b, c]) => a !== b && b !== c && a !== c);
  add("they are equally spaced", ([a, b, c]) => b - a === c - b);
  add("the third is the sum of the first two", ([a, b, c]) => a + b === c);
  add("all three have the same parity", ([a, b, c]) => a % 2 === b % 2 && b % 2 === c % 2);
  return out;
}

const cell = (t: Triple): number => (t[0] * DOMAIN + t[1]) * DOMAIN + t[2];
const tripleAt = (i: number): Triple => [Math.floor(i / (DOMAIN * DOMAIN)), Math.floor(i / DOMAIN) % DOMAIN, i % DOMAIN];

function bitsOf(holds: (t: Triple) => boolean): Uint32Array {
  const bits = new Uint32Array(WORDS);
  for (let i = 0; i < CELLS; i++) if (holds(tripleAt(i))) bits[i >>> 5]! |= 1 << (i & 31);
  return bits;
}
const count = (bits: Uint32Array): number => {
  let n = 0;
  for (let w of bits) { while (w) { w &= w - 1; n++; } }
  return n;
};

let built: readonly Built[] | null = null;

/**
 * Every rule, in a fixed order: the simple ones, then each pair joined by "and" and by "or".
 *
 * Kept only if it is neither nearly always yes nor nearly always no, and only the first of any rules
 * that agree on every triple, so the list is of rules that can actually be told apart. Built once, from
 * one bitset per simple rule; a pair is two bitsets combined, which is why this takes milliseconds.
 */
function rules(): readonly Built[] {
  if (built) return built;
  const simple = simpleRules().map((r) => ({ ...r, bits: bitsOf(r.holds) }));
  const out: Built[] = [];
  const seen = new Set<string>();
  const keep = (r: Built) => {
    const share = count(r.bits) / CELLS;
    if (share < RARE || share > 1 - RARE) return;
    const key = r.bits.join(",");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(r);
  };
  for (const r of simple) keep(r);
  for (let i = 0; i < simple.length; i++) {
    for (let j = i + 1; j < simple.length; j++) {
      const x = simple[i]!, y = simple[j]!;
      keep({ name: `${x.name}, and ${y.name}`, holds: (t) => x.holds(t) && y.holds(t),
             bits: x.bits.map((w, k) => w & y.bits[k]!) });
      keep({ name: `${x.name}, or ${y.name}`, holds: (t) => x.holds(t) || y.holds(t),
             bits: x.bits.map((w, k) => w | y.bits[k]!) });
    }
  }
  built = out;
  return built;
}

/** The names of every rule, in order. What the harness publishes and what an answer is chosen from. */
export function ruleNames(): readonly string[] { return rules().map((r) => r.name); }

/** Whether rule number `index` holds for a triple, by lookup. For solvers that ask it many times. */
export function holdsAt(index: number, t: Triple): boolean {
  const i = cell(t);
  return ((rules()[index]!.bits[i >>> 5]! >>> (i & 31)) & 1) === 1;
}

function indexFor(seed: Seed): number {
  return Math.floor(stream(seed, "zendo/rule")() * rules().length);
}

export function ruleFor(seed: Seed): Rule { return rules()[indexFor(seed)]!; }

const normal = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

let byName: ReadonlyMap<string, number> | null = null;

/**
 * Which rule a name names, or -1. Case and spacing do not matter; the words do.
 *
 * By a map built once. It was a scan of all five thousand names per lookup, which made checking every
 * name take six seconds on CI and would have made the checker a scan too.
 */
export function ruleNamed(name: string): number {
  byName ??= new Map(rules().map((r, i) => [normal(r.name), i]));
  return byName.get(normal(name)) ?? -1;
}

/** Every seventh triple: enough candidate questions to split well, few enough to choose among quickly. */
const QUESTION_STRIDE = 7;

/**
 * The reference solver: ask the triple that splits the rules still possible most evenly, until one
 * is left, and name it.
 *
 * In the open like the rest, because the list it works from is public and so is the idea. Tests use it
 * to measure what honest play costs, which is the number a guess is held against.
 */
export async function solve(ask: (t: Triple) => Promise<boolean>): Promise<{ readonly name: string; readonly asked: number }> {
  const questions: Triple[] = [];
  for (let i = 0; i < CELLS; i += QUESTION_STRIDE) questions.push(tripleAt(i));
  let possible = rules().map((_, i) => i);
  let asked = 0;
  while (possible.length > 1) {
    let best = questions[0]!, worst = Infinity;
    for (const t of questions) {
      let yes = 0;
      for (const r of possible) if (holdsAt(r, t)) yes++;
      const left = Math.max(yes, possible.length - yes);
      if (left < worst) { worst = left; best = t; }
    }
    if (worst === possible.length) break;   // no question tells what is left apart
    const said = await ask(best);
    asked++;
    possible = possible.filter((r) => holdsAt(r, best) === said);
  }
  return { name: rules()[possible[0]!]!.name, asked };
}

const parseTriple = (q: unknown): Triple | null => {
  if (!Array.isArray(q) || q.length !== 3) return null;
  if (!q.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < DOMAIN)) return null;
  return [q[0], q[1], q[2]];
};

export const zendo: Problem = register({
  id: "zendo",
  title: "Zendo",
  category: "induction",
  level: "medium",
  par: null,
  statement:
    "A rule decides whether a triple of numbers from 0 to 19 belongs. Propose any triple and learn only " +
    "yes or no; each question costs. Then name the rule, from the list the harness publishes. There " +
    "are thousands of rules, simple ones and pairs of them, so choose each triple to split what is " +
    "still possible.",
  harness: (seed) => ({
    probe: "[a, b, c], three whole numbers from 0 to 19",
    answer: '"the sum is divisible by 3, and it contains 7", a rule\'s name as the list gives it',
    domain: `0 to ${DOMAIN - 1}`,
    rules: ruleNames(),
    note:
      "The list is built in src/problems/zendo.ts: the simple rules, then each pair joined by and and by " +
      "or, keeping one of any that agree on every triple. Case and spacing in an answer do not matter.",
    generator: GENERATOR,
    example: { seed, rule: ruleFor(seed).name },
  }),
  initialState: () => null,
  probe(seed, question, state) {
    const t = parseTriple(question);
    if (!t) return null;
    return { answer: { holds: holdsAt(indexFor(seed), t) }, state };
  },
  check(seed, answer) {
    return typeof answer === "string" && ruleNamed(answer) === indexFor(seed);
  },
});
