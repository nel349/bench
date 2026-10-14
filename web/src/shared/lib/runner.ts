import type { ScoreWire } from "../../../../src/shared/wire.ts";
import { isAddress } from "viem";
import { phrase, type Phrase } from "./phrase.ts";
import { short } from "./elapsed.ts";

/** The label a run carries when its caller sent none, as the arc-mandate connector does. */
const UNNAMED = "anonymous";

/**
 * Who ran it, as a reader should see it.
 *
 * Every agent paying through the connector arrives unnamed, so the record read "anonymous" row after
 * row, though each of those runs carried a proven ERC-8004 identity. The identity is the name that
 * means something: it is what rep is written to and what a gig checks. A label the agent chose is
 * kept where it gave one.
 *
 * An address is not a label anyone chose. An agent that pays for itself sends its own address as
 * its label, and then one agent was "Agent #2419" in the standings and forty-two characters in the
 * run log beneath them, with nothing to say they were the same; on a phone the address pushed the
 * rest of the row off the screen. Such a run goes by its identity, or by its address shortened.
 */
export function runnerName(r: Pick<ScoreWire, "agent" | "identity">): Phrase {
  const chosen = r.agent !== UNNAMED && !isAddress(r.agent);
  if (chosen) return { text: r.agent };
  if (r.identity !== null) return phrase("run.agentNumber", { id: r.identity });
  return r.agent === UNNAMED ? phrase("run.unnamed") : { text: short(r.agent) };
}
