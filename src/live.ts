/**
 * How long after it starts an open run counts as being played now.
 *
 * A run an agent walks away from is never closed, so "open" alone said an agent abandoned three days
 * ago was playing. The record keeps when a run started, not when it was last touched; an hour is
 * longer than any run so far has taken, the slowest being a quarter of that.
 */
export const LIVE_FOR_MS = 60 * 60 * 1000;

/** The run an agent is playing now, from its runs newest first: open, and started within the hour. */
export function playingNow<R extends { readonly endedBy: string; readonly startedAt: number }>(
  runs: readonly R[], now = Date.now(),
): R | null {
  return runs.find((r) => r.endedBy === "open" && now - r.startedAt < LIVE_FOR_MS) ?? null;
}
