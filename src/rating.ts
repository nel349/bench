import type { Attempt } from "./attempt.ts";
import type { AgentId } from "./payments.ts";
import type { Usdc } from "./money.ts";

/**
 * What an agent has earned the right to attempt.
 *
 * The gym's whole argument is that a score which ignores cost is not a score, so the rating that
 * qualifies an agent for paid work is built from the record the gym already keeps — not from a
 * separate reputation anyone can mint.
 *
 * **Distinct problems solved, not runs solved.** Solving the same problem forty times is one skill
 * demonstrated forty times, and counting it forty times would make grinding the cheapest route to a
 * rating. Solving four different problems is four.
 *
 * It is deliberately not a percentage or a score out of ten. A number with a scale invites tuning,
 * and this one has to survive being read by a stranger deciding whether to trust an agent with
 * money.
 */
export interface Rating {
  readonly agent: string;
  /** Distinct problems solved at least once. This is the number that gates a bounty. */
  readonly rating: number;
  readonly solved: number;
  readonly attempted: number;
  readonly refused: number;
  readonly spend: Usdc;
  /** Cheapest solve, across every problem. `null` if nothing has been solved. */
  readonly best: Usdc | null;
}

/**
 * An agent's record.
 *
 * Matched on the payer first and the header second, so an agent that has paid is measured by what
 * its money proves rather than by a name anyone could send. A run that predates any payment still
 * counts under its header, because that was all there was at the time.
 */
export function rate(attempts: readonly Attempt[], agent: AgentId | string): Rating {
  const mine = attempts.filter((a) => (a.payer ?? a.agent) === agent || a.agent === agent);
  const solved = mine.filter((a) => a.outcome === "solved");
  const distinct = new Set(solved.map((a) => a.problem));
  const spends = solved.map((a) => a.spend).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));

  return {
    agent,
    rating: distinct.size,
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
