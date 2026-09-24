import { register, GENERATOR, type Problem } from "./problem.ts";
import { stream, type Seed } from "./seed.ts";

/**
 * Ranking: put eight things in order when every comparison costs.
 *
 * There is a hidden order, best to worst. A probe names two items and learns which is better, and
 * that is the only way to learn anything. It is the job of choosing between outputs with a judge
 * that charges per verdict, and it has a proven answer: there are 40,320 possible orders, each
 * comparison at best halves them, so no method can guarantee fewer than sixteen, and Ford and
 * Johnson's merge insertion always manages sixteen. Comparing every pair costs twenty-eight.
 */

export const ITEMS = "ABCDEFGH";
/** Every order there is, 8!. */
export const ORDERS = [...ITEMS].reduce((n, _, i) => n * (i + 1), 1);

/** The hidden order, best first. */
export function orderFrom(seed: Seed): string {
  const next = stream(seed, "ranking/order");
  const items = [...ITEMS];
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items.join("");
}

/** Which of two items the hidden order ranks higher. */
export function better(order: string, a: string, b: string): string {
  return order.indexOf(a) < order.indexOf(b) ? a : b;
}

const isItem = (c: unknown): c is string => typeof c === "string" && c.length === 1 && ITEMS.includes(c.toUpperCase());

function parsePair(q: unknown): readonly [string, string] | null {
  if (!Array.isArray(q) || q.length !== 2 || !isItem(q[0]) || !isItem(q[1])) return null;
  const [a, b] = [q[0].toUpperCase(), q[1].toUpperCase()];
  return a === b ? null : [a, b];
}

/** An order as the agent wrote it: every item once, best first, as a string or an array. */
export function parseOrder(a: unknown): string | null {
  const text = Array.isArray(a) && a.every((c) => typeof c === "string") ? a.join("") : a;
  if (typeof text !== "string") return null;
  const order = text.toUpperCase();
  if (order.length !== ITEMS.length || new Set(order).size !== ITEMS.length) return null;
  return [...order].every((c) => ITEMS.includes(c)) ? order : null;
}

export const ranking: Problem = register({
  id: "ranking",
  title: "Ranking",
  category: "costly comparison",
  level: "medium",
  par: 16,
  statement:
    `Eight items, ${ITEMS.split("").join(", ")}, have a hidden order from best to worst. Name two ` +
    "and learn which is better; each comparison costs. Then submit all eight, best first. Comparing " +
    "every pair costs twenty-eight. Sixteen is always enough, and no method can promise fewer.",
  harness: (seed) => ({
    probe: `["A", "C"], two different items`,
    answer: `all eight, best first, like "CAHBEDGF"`,
    items: ITEMS, orders: ORDERS,
    note: "An order is a function of its seed, in src/problems/ranking.ts.",
    generator: GENERATOR,
    example: { seed, order: orderFrom(seed) },
  }),
  initialState: () => null,
  probe(seed, question, state) {
    const pair = parsePair(question);
    if (!pair) return null;
    return { answer: { compared: pair, better: better(orderFrom(seed), pair[0], pair[1]) }, state };
  },
  check(seed, answer) {
    return parseOrder(answer) === orderFrom(seed);
  },
});
