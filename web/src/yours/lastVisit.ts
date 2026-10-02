import { useEffect, useState } from "react";

const KEY = (wallet: string) => `bench.owner.seen.${wallet.toLowerCase()}`;

/** How long the page must be open before it counts as seen, so a page flicked past does not. */
const SEEN_AFTER_MS = 5_000;

/**
 * When this browser last looked at a wallet's page: read once when it opens, and moved to now once
 * it has been open a few seconds. `null` the first time, when everything is new and nothing is.
 */
export function useLastVisit(wallet: string | null): number | null {
  const [previous, setPrevious] = useState<number | null>(null);
  useEffect(() => {
    if (wallet === null) return;
    try {
      const kept = Number(localStorage.getItem(KEY(wallet)));
      setPrevious(Number.isFinite(kept) && kept > 0 ? kept : null);
    } catch {
      setPrevious(null);
    }
    const mark = setTimeout(() => {
      try { localStorage.setItem(KEY(wallet), String(Date.now())); } catch { /* not kept; nothing lost */ }
    }, SEEN_AFTER_MS);
    return () => clearTimeout(mark);
  }, [wallet]);
  return previous;
}

/** What happened in some runs since a moment: how many, what they cost, and how many were recorded. */
export function sinceSummary(runs: readonly { readonly startedAt: number; readonly spend: string; readonly ranked: boolean }[], since: number) {
  const fresh = runs.filter((r) => r.startedAt > since);
  const spend = fresh.reduce((t, r) => t + Number(r.spend), 0);
  return { runs: fresh.length, spend: spend.toFixed(6), recorded: fresh.filter((r) => r.ranked).length };
}
