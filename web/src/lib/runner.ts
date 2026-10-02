import type { ScoreWire } from "../../../src/wire.ts";

/** The label a run carries when its caller sent none, as the arc-mandate connector does. */
const UNNAMED = "anonymous";

/**
 * Who ran it, as a reader should see it.
 *
 * Every agent paying through the connector arrives unnamed, so the record read "anonymous" row after
 * row, though each of those runs carried a proven ERC-8004 identity. The identity is the name that
 * means something: it is what rep is written to and what a gig checks. A label the agent chose is
 * kept where it gave one.
 */
export function runnerName(r: Pick<ScoreWire, "agent" | "identity">): string {
  if (r.agent !== UNNAMED) return r.agent;
  return r.identity !== null ? `agent #${r.identity}` : UNNAMED;
}
