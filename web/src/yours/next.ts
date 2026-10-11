import type { OwnerAgentWire } from "../../../src/shared/wire.ts";

/**
 * What an agent's owner might do next, as a decision and before any words.
 *
 * - `nothing`: said elsewhere on the card already, or not known. An agent the wallet does not grant
 *   to has its own note, and rep the registry would not give is not guessed at.
 * - `start`: it has never played.
 * - `record`: it has played and recorded nothing, so it has no rep and is not on the standings.
 * - `more`: it has recorded some exercises and not others; `left` is the ones still to record.
 * - `all`: every exercise recorded. Rep cannot go higher, and what is left is to solve for less.
 */
export type Next =
  | { readonly kind: "nothing" | "start" | "record" | "all" }
  | { readonly kind: "more"; readonly left: readonly string[] };

export function nextFor(
  agent: Pick<OwnerAgentWire, "current" | "repUnread" | "ranked" | "runs">, exercises: readonly string[],
): Next {
  if (!agent.current || agent.repUnread) return { kind: "nothing" };
  if (agent.runs.length === 0) return { kind: "start" };
  const left = exercises.filter((id) => !agent.ranked.includes(id));
  if (agent.ranked.length === 0) return { kind: "record" };
  // Every exercise the gym serves, which says nothing while the list of them has not arrived.
  if (left.length === 0) return exercises.length === 0 ? { kind: "nothing" } : { kind: "all" };
  return { kind: "more", left };
}
