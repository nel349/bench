import type { Attempt } from "./attempt.ts";
import type { AgentId } from "./payments.ts";
import type { Usdc } from "./money.ts";
import { LEVEL_WEIGHT, problemOf } from "./problems/problem.ts";

export { LEVEL_WEIGHT };

/**
 * What an agent has earned the right to attempt.
 *
 * The gym's whole argument is that a score which ignores cost is not a score, so the rating that
 * qualifies an agent for paid work is built from what it solved and paid for, not from a
 * reputation anyone can mint.
 *
 * **Distinct problems ranked, weighted by level.** Solving the same problem forty times is one skill
 * demonstrated forty times, so each problem counts once. And a hard problem counts for more than an
 * easy one, so the bar cannot be filled by grinding the easy ones: easy 1, medium 2, hard 3.
 *
 * **Ranked, not merely solved.** A ranked run is one the agent paid to have written to its ERC-8004
 * identity, and the bounty gate reads the rating back from there, so a poster can check it without
 * us. The rating here counts the same runs from our own records, which is what `/rating/:address`
 * shows; the chain is what decides.
 */
/** The weighted rating of a set of problems, each counted once. Problems this gym does not serve count nothing. */
export function weigh(problems: Iterable<string>): number {
  let total = 0;
  for (const id of new Set(problems)) {
    const p = problemOf(id);
    if (p) total += LEVEL_WEIGHT[p.level];
  }
  return total;
}

export interface Rating {
  readonly agent: string;
  /** Distinct problems ranked, weighted by level. See `weigh`. */
  readonly rating: number;
  readonly solved: number;
  readonly attempted: number;
  readonly refused: number;
  readonly spend: Usdc;
  /** Cheapest solve, across every problem. `null` if nothing has been solved. */
  readonly best: Usdc | null;
}

/**
 * The runs an address paid for, which are the only runs that are anybody's record.
 *
 * It used to match the name in the header as well. A header is a claim anyone can send, and a run
 * nobody paid for proves nothing about anyone, so the two together let three free solves under any
 * name qualify that name for a bounty. Addresses are compared without case, because a checksummed
 * address and a lowercase one are the same account.
 */
export function paidBy(attempts: readonly Attempt[], who: AgentId | string): Attempt[] {
  const want = who.toLowerCase();
  return attempts.filter((a) => a.payer !== null && a.payer.toLowerCase() === want);
}

/** An agent's record, from the runs its money paid for. See `paidBy`. */
export function rate(attempts: readonly Attempt[], agent: AgentId | string): Rating {
  const mine = paidBy(attempts, agent);
  const solved = mine.filter((a) => a.outcome === "solved");
  const ranked = solved.filter((a) => a.rank?.tx).map((a) => a.problem);
  const spends = solved.map((a) => a.spend).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));

  return {
    agent,
    rating: weigh(ranked),
    solved: solved.length,
    attempted: mine.length,
    refused: mine.filter((a) => a.outcome === "refused").length,
    spend: mine.reduce((total, a) => total + a.spend, 0n),
    best: spends[0] ?? null,
  };
}

/** JSON-safe, because `Usdc` is a bigint and `JSON.stringify` throws on those rather than rounding. */
export interface WireRating extends Omit<Rating, "spend" | "best"> {
  readonly spend: string;
  readonly best: string | null;
}
