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
export interface Problem {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly statement: string;
  /** Everything a stranger needs to rebuild this instance and replay a run. Free, always. */
  harness(seed: number): unknown;
  /** Where an attempt begins. */
  initialState(seed: number): unknown;
  /**
   * Answer one paid question.
   *
   * Returns `null` for a question that does not parse — which the caller must treat as a 400 and
   * **not** a charge. Nobody should pay for being told their JSON was wrong.
   */
  probe(seed: number, question: unknown, state: unknown): { answer: unknown; state: unknown } | null;
  /** Is this answer right? Machine-decided, with no appeal and no human in it. */
  check(seed: number, answer: unknown): boolean;
}

const registry = new Map<string, Problem>();

export function register(p: Problem): Problem {
  registry.set(p.id, p);
  return p;
}
export function problemOf(id: string): Problem | undefined { return registry.get(id); }
export function allProblems(): Problem[] { return [...registry.values()]; }
