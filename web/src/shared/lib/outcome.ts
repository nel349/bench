import type { ScoreWire } from "../../../../src/shared/wire.ts";
import { phrase, type Phrase } from "./phrase.ts";
import { LIVE_FOR_MS } from "../../../../src/shared/live.ts";

/**
 * What a run did for the agent's record, as a word and a tone.
 *
 * A solve is not rep until it is recorded, and a recorded run adds rep only the first time on that
 * exercise, so no row claims a number: Recorded says it is on the record, and rep says how much.
 */
export const outcomeOf = (
  r: Pick<ScoreWire, "endedBy" | "ranked"> & { readonly startedAt?: number }, now = Date.now(),
): { readonly label: Phrase; readonly tone: string } =>
  r.endedBy === "solved" && r.ranked ? { label: phrase("outcome.recorded"), tone: "rep" }
  : r.endedBy === "solved" ? { label: phrase("outcome.solved"), tone: "rep" }
  : r.endedBy === "refused" ? { label: phrase("outcome.ranOut"), tone: "ice" }
  // A run walked away from is never closed; past the hour it is not being played, it was left.
  : r.startedAt !== undefined && now - r.startedAt >= LIVE_FOR_MS ? { label: phrase("outcome.leftOpen"), tone: "dim" }
  : { label: phrase("outcome.playing"), tone: "dim" };
