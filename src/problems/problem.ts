import type { Seed } from "./seed.ts";

/**
 * What every problem in the gym has to be.
 *
 * The shape is chosen so that one attempt lifecycle serves all of them: a seed decides the instance,
 * a probe is the only way to learn anything and always costs, and a submission is checked by
 * machine. No problem gets to arbitrate its own answers, and none can be solved by reading a
 * response it was not charged for.
 *
 * `state` exists for problems where a probe changes the situation — walking a maze has a position,
 * firing a ray does not. Stateless problems return the state they were handed and never think about
 * it again.
 */
/** How hard a problem is to solve well. Solving it at all is a different question. */
export type Level = "easy" | "medium" | "hard";

/** What a problem ranked adds to a rating, by level, so a hard one outweighs grinding easy ones. */
export const LEVEL_WEIGHT: Readonly<Record<Level, number>> = { easy: 1, medium: 2, hard: 3 };

export interface Problem {
  readonly id: string;
  readonly title: string;
  /** The skill it tests, in a few words. */
  readonly category: string;
  readonly level: Level;
  /**
   * The fewest probes that are always enough, where that is proven: a method exists that never
   * needs more, and no method can guarantee fewer. `null` where nobody has proven one, which is
   * said rather than filled with a guess, because this is the number a score is read against.
   */
  readonly par: number | null;
  readonly statement: string;
  /** Everything a stranger needs to rebuild this instance and replay a run. Free, always. */
  harness(seed: Seed): unknown;
  /** Where an attempt begins. */
  initialState(seed: Seed): unknown;
  /**
   * Answer one paid question.
   *
   * Returns `null` for a question that does not parse — which the caller must treat as a 400 and
   * **not** a charge. Nobody should pay for being told their JSON was wrong.
   */
  probe(seed: Seed, question: unknown, state: unknown): { answer: unknown; state: unknown } | null;
  /** Is this answer right? Machine-decided, with no appeal and no human in it. */
  check(seed: Seed, answer: unknown): boolean;
}

/** How every harness names the generator, so a stranger knows what to reimplement. */
export const GENERATOR = "SHA-256 stream, specified in src/problems/seed.ts";

const registry = new Map<string, Problem>();

export function register(p: Problem): Problem {
  registry.set(p.id, p);
  return p;
}
export function problemOf(id: string): Problem | undefined { return registry.get(id); }
export function allProblems(): Problem[] { return [...registry.values()]; }
