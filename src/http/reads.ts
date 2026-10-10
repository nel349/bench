import { type Attempt } from "../gym/attempt.ts";
import { weigh } from "../gym/rating.ts";
import type { Deps } from "./deps.ts";

/**
 * The weighted rating of an ERC-8004 id, read from where ranked runs are written.
 *
 * No id, or no registry, is a rating of nothing rather than an error: an agent that has not claimed
 * an identity has no record to read. A registry that cannot be read throws, and the caller says so,
 * because refusing someone for a record we failed to read would be our fault reported as theirs.
 */
export async function ratingOf(deps: Deps, agentId: bigint | null): Promise<number> {
  if (agentId === null || !deps.reputation) return 0;
  return weigh(await deps.reputation.ranked(agentId));
}
/**
 * The identity each paying address's newest run carries, by address in lower case: how a win or a
 * payer is named. Read off the record in one pass, for a list that names many payers at once.
 */
export function identitiesByPayer(all: readonly Attempt[]): ReadonlyMap<string, string> {
  const newest = new Map<string, { readonly identity: string; readonly at: number }>();
  for (const a of all) {
    if (a.payer === null || a.identity === null) continue;
    const payer = a.payer.toLowerCase();
    const known = newest.get(payer);
    if (known === undefined || a.startedAt > known.at) newest.set(payer, { identity: a.identity, at: a.startedAt });
  }
  return new Map([...newest].map(([payer, { identity }]) => [payer, identity]));
}
/**
 * Who holds each identity, remembered for a while: an owner's page asks about every identity in the
 * record, and an identity changes hands rarely if ever.
 *
 * Only an answer is remembered for long. A read that failed throws: it was once kept as "nobody",
 * and a revoked agent vanished from its owner's page for ten minutes after one hiccup. The failure
 * itself is kept for a few seconds, as a failure, so a registry that is down is not asked again by
 * every request for every identity while it is. Asked once however many requests want it at the same
 * moment. Kept per `Deps`, so one gym's answers are never another's.
 */
export const OWNER_CACHE_MS = 10 * 60 * 1000;
/** How long a registry that would not answer is left alone before it is asked again. */
export const OWNER_RETRY_MS = 15_000;
/** `until` is when it stops being good, and `null` while it is still being read. */
type Held = { readonly owner: Promise<string | null>; until: number | null };
const holders = new WeakMap<Deps, Map<string, Held>>();
export function cachedOwnerOf(deps: Deps, identity: string): Promise<string | null> {
  const known = holders.get(deps) ?? new Map<string, Held>();
  holders.set(deps, known);
  const hit = known.get(identity);
  if (hit && (hit.until === null || Date.now() < hit.until)) return hit.owner;
  const held: Held = { owner: deps.ownerOf!(BigInt(identity)), until: null };
  known.set(identity, held);
  held.owner.then(
    () => { held.until = Date.now() + OWNER_CACHE_MS; },
    () => { held.until = Date.now() + OWNER_RETRY_MS; },
  );
  return held.owner;
}
