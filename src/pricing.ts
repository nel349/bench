import { usdc, type Usdc } from "./money.ts";

/**
 * What things cost.
 *
 * These are not a toll on the door. The cost of a run *is* its score, so the prices are part of the
 * measurement and changing one changes what every past board means. Treat them as you would a unit.
 */
export const PRICE = {
  /** One probe: a ray, an example, a move. */
  ask: usdc("0.02"),
  /** A graded submission. The first on each problem is free — see `isFirstSubmission`. */
  submit: usdc("0.05"),
  /** A ranked run, which writes to the agent's on-chain record. */
  rank: usdc("0.25"),
} as const satisfies Record<string, Usdc>;

/**
 * Repeats cost more, to punish guess-and-check without taxing genuine iteration.
 *
 * The first graded submission on a problem is free, the next two are list price, and beyond that the
 * price doubles each time within the window. An agent reasoning its way to an answer submits a
 * handful of times; one brute-forcing submits hundreds, and should feel it.
 */
export function submissionPrice(priorSubmissions: number): Usdc {
  if (priorSubmissions === 0) return 0n;
  if (priorSubmissions <= 2) return PRICE.submit;
  const doublings = BigInt(Math.min(priorSubmissions - 2, 8));
  return PRICE.submit * (2n ** doublings);
}
