import { useCallback, useState } from "react";

const KEY = "bench.owner.wallet";
const WALLET = /^0x[0-9a-fA-F]{40}$/;

/** Whether some text is a wallet address. */
export const isWallet = (text: string): boolean => WALLET.test(text.trim());

function read(): string | null {
  try {
    const kept = localStorage.getItem(KEY);
    return kept !== null && isWallet(kept) ? kept : null;
  } catch {
    return null;
  }
}

/**
 * The owner's wallet, as this browser last opened it.
 *
 * Remembered so the header can offer the owner's page on the next visit, the way it is offered on
 * the visit that opened it. Only a convenience: storage a browser refuses, or clears, costs nothing
 * but that offer, and the page itself is always reachable by its link.
 */
export function useOwnerWallet(): readonly [string | null, (wallet: string) => void] {
  const [wallet, setWallet] = useState<string | null>(read);
  const remember = useCallback((next: string) => {
    if (!isWallet(next)) return;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Not kept; the page still opens from its link.
    }
    setWallet(next);
  }, []);
  return [wallet, remember] as const;
}
