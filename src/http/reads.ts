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
/** The identity a paying address's runs carry, newest first: how a win or a payer is named. */
export function identityOfPayer(all: readonly Attempt[], payer: string | null): string | null {
  if (payer === null) return null;
  const p = payer.toLowerCase();
  const run = [...all].sort((x, y) => y.startedAt - x.startedAt)
    .find((a) => a.payer?.toLowerCase() === p && a.identity !== null);
  return run?.identity ?? null;
}
/**
 * Who holds each identity, remembered for a while: an owner's page asks about every identity in the
 * record, and an identity changes hands rarely if ever.
 */
export const OWNER_CACHE_MS = 10 * 60 * 1000;
export const ownerCache = new Map<string, { readonly owner: string | null; readonly at: number }>();
export async function cachedOwnerOf(deps: Deps, identity: string): Promise<string | null> {
  const hit = ownerCache.get(identity);
  if (hit && Date.now() - hit.at < OWNER_CACHE_MS) return hit.owner;
  const owner = await deps.ownerOf!(BigInt(identity)).catch(() => null);
  ownerCache.set(identity, { owner, at: Date.now() });
  return owner;
}
