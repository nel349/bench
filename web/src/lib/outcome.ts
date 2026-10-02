import type { ScoreWire } from "../../../src/wire.ts";
import { LIVE_FOR_MS } from "../../../src/live.ts";

/**
 * What a run did for the agent's record, as a word and a tone.
 *
 * A breach is not rep until it is ranked, and a ranked run adds rep only the first time on that ICE,
 * so no row claims a number: RANKED says it is on the record, and the rating says how much.
 */
export const outcomeOf = (
  r: Pick<ScoreWire, "endedBy" | "ranked"> & { readonly startedAt?: number }, now = Date.now(),
): { readonly label: string; readonly tone: string } =>
  r.endedBy === "solved" && r.ranked ? { label: "RANKED", tone: "rep" }
  : r.endedBy === "solved" ? { label: "BREACHED", tone: "rep" }
  : r.endedBy === "refused" ? { label: "FLATLINED", tone: "ice" }
  // A run walked away from is never closed; past the hour it is not in progress, it was left.
  : r.startedAt !== undefined && now - r.startedAt >= LIVE_FOR_MS ? { label: "LEFT OPEN", tone: "dim" }
  : { label: "IN PROGRESS", tone: "dim" };
