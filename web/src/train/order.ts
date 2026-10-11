import type { ProblemWire } from "../../../src/shared/wire.ts";
import { LEVEL_WEIGHT } from "../../../src/problems/problem.ts";

/**
 * The exercises as an owner reads down them: easiest first, and within a level in the order the gym
 * lists them. The gym's own order is the order they were built in, which says nothing to a reader.
 */
export function byLevel<P extends Pick<ProblemWire, "level">>(problems: readonly P[]): P[] {
  return problems.map((p, i) => ({ p, i }))
    .sort((x, y) => LEVEL_WEIGHT[x.p.level] - LEVEL_WEIGHT[y.p.level] || x.i - y.i)
    .map(({ p }) => p);
}
