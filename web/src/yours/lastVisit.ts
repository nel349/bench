import { useEffect, useState } from "react";
import type { OwnerRunWire } from "../../../src/shared/wire.ts";
import { format, usdc } from "../../../src/shared/money.ts";

const KEY = (wallet: string) => `bench.owner.seen.${wallet.toLowerCase()}`;

/** How long the page must be open before it counts as seen, so a page flicked past does not. */
const SEEN_AFTER_MS = 5_000;

/**
 * When this browser last looked at a wallet's page: read once when it opens, and moved to now once
 * the page has shown its agents for a few seconds. `null` the first time, when everything is new and
 * nothing is. A page that only failed to load, or never finished, was not looked at.
 */
export function useLastVisit(wallet: string | null, shown: boolean): number | null {
  const [previous, setPrevious] = useState<number | null>(null);
  useEffect(() => {
    if (wallet === null) return;
    try {
      const kept = Number(localStorage.getItem(KEY(wallet)));
      setPrevious(Number.isFinite(kept) && kept > 0 ? kept : null);
    } catch {
      setPrevious(null);
    }
  }, [wallet]);
  useEffect(() => {
    if (wallet === null || !shown) return;
    const mark = setTimeout(() => {
      try { localStorage.setItem(KEY(wallet), String(Date.now())); } catch { /* not kept; nothing lost */ }
    }, SEEN_AFTER_MS);
    return () => clearTimeout(mark);
  }, [wallet, shown]);
  return previous;
}

/**
 * What happened in some runs since a moment: how many, what was paid for them, and how many were
 * recorded. `paid`, not `spend`: a run's spend is its score and leaves out the fee for recording it,
 * and this line once said $0.14 for a run its owner had paid $0.39 for.
 */
export function sinceSummary(runs: readonly Pick<OwnerRunWire, "startedAt" | "paid" | "ranked">[], since: number) {
  const fresh = runs.filter((r) => r.startedAt > since);
  const micros = fresh.reduce((t, r) => t + usdc(r.paid), 0n);
  return { runs: fresh.length, spend: format(micros), recorded: fresh.filter((r) => r.ranked).length };
}
