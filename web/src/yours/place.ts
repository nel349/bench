import type { StandingsWire } from "../../../src/shared/wire.ts";

/**
 * Where one agent stands among the others, or why that cannot be said.
 *
 * - `placed`: it is among the agents the gym lists.
 * - `past`: it has recorded a solve and is not among the ones listed, so it stands somewhere after
 *   them. The gym lists the first so many and counts the rest.
 * - `absent`: it has recorded nothing, so it is not on the standings.
 * - `unread`: the standings have not arrived, or could not be read. That is not the same as not
 *   being on them, and an agent at the top was once told it was "not on the standings yet" for the
 *   moment the page took to load.
 */
export type Place =
  | { readonly kind: "placed"; readonly place: number; readonly of: number; readonly holds: number }
  | { readonly kind: "past"; readonly listed: number }
  | { readonly kind: "absent" }
  | { readonly kind: "unread" };

/**
 * @param table the standings, or `undefined` while they are not known
 * @param identity the identity the agent's rep is written to, or `null` where it has none
 * @param recorded whether the registry says it has recorded any exercise
 */
export function placeOf(table: StandingsWire | undefined, identity: string | null, recorded: boolean): Place {
  if (table === undefined) return { kind: "unread" };
  const at = identity === null ? -1 : table.agents.findIndex((a) => a.identity === identity);
  if (at !== -1) {
    return { kind: "placed", place: at + 1, of: table.agents.length + table.more, holds: table.agents[at]!.holds.length };
  }
  return recorded && table.more > 0 ? { kind: "past", listed: table.agents.length } : { kind: "absent" };
}
