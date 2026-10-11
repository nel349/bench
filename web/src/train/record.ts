import type { BestWire } from "../../../src/shared/wire.ts";
import { usdc } from "../../../src/shared/money.ts";
import { parCost } from "./par.ts";

/**
 * Where an exercise's record stands against the fewest questions the exercise needs.
 *
 * The fewest needed is what a method can promise, whatever the hidden answer turns out to be. A
 * record above it has room that skill alone can take. One at it can only be beaten by a run the
 * hidden answer was kind to, and one under it already was such a run. Where no fewest is proven
 * there is nothing to measure against, and that is said rather than guessed at.
 */
export type RecordStanding = "none" | "unproven" | "above" | "at" | "under";

export function recordStanding(
  par: number | null, ask: string, best: Pick<BestWire, "spend"> | undefined,
): RecordStanding {
  if (best === undefined) return "none";
  const floor = parCost(par, ask);
  if (floor === null) return "unproven";
  const cost = usdc(best.spend), needed = usdc(floor);
  return cost > needed ? "above" : cost < needed ? "under" : "at";
}
