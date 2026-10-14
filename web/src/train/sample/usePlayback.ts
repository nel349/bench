import { useEffect, useState } from "react";
import { useClock, usePrefersReducedMotion } from "../demo/useClock.ts";

/** How long a finished drawing stays up before it plays again, so the answer can be read. */
export const MS_HOLD_SOLVED = 3_200;

/**
 * Which step of a drawing to show: 0 is nothing yet, `steps` is all of it.
 *
 * It counts up one step every `msPerStep`, holds the finished drawing, then starts over, for as long
 * as the page is open. Someone who has asked for less motion gets the finished drawing and nothing
 * moving, as on the front page.
 */
export function usePlayback(steps: number, msPerStep: number): number {
  const reduced = usePrefersReducedMotion();
  const [round, setRound] = useState(0);
  const elapsed = useClock(round, !reduced);
  const done = elapsed >= steps * msPerStep + MS_HOLD_SOLVED;
  useEffect(() => { if (done) setRound((r) => r + 1); }, [done]);
  if (reduced) return steps;
  return Math.min(steps, Math.floor(elapsed / msPerStep));
}
