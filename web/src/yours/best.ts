import type { OwnerRunWire } from "../../../src/shared/wire.ts";
import { usdc } from "../../../src/shared/money.ts";

/** What a run needs to say to be compared: what it was on, whether it was solved, and what solving it cost. */
type Run = Pick<OwnerRunWire, "problem" | "solved" | "spend" | "probes" | "ranked">;

/**
 * An agent's best on each exercise it has solved: the cheapest solve, and among equals the one with
 * fewer questions, which is how the gym itself orders a leaderboard. `spend`, not what its owner
 * paid: the fee for recording a solve is no part of how well it was solved.
 *
 * Whether it has recorded that exercise is said beside it, and is true if any solve of it was
 * recorded, not only the best one: rep is for the exercise, whichever run earned it.
 */
export function bestByExercise<R extends Run>(runs: readonly R[]): Map<string, { readonly run: R; readonly recorded: boolean }> {
  const best = new Map<string, { run: R; recorded: boolean }>();
  for (const run of runs) {
    if (!run.solved) continue;
    const held = best.get(run.problem);
    const cheaper = held === undefined
      || usdc(run.spend) < usdc(held.run.spend)
      || (usdc(run.spend) === usdc(held.run.spend) && run.probes < held.run.probes);
    best.set(run.problem, { run: cheaper ? run : held.run, recorded: (held?.recorded ?? false) || run.ranked });
  }
  return best;
}
