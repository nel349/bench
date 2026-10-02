import { useCallback, useState } from "react";

const KEY = "bench.owner.wallet";
const WALLET = /^0x[0-9a-fA-F]{40}$/;

/** Whether some text is a wallet address. */
export const isWallet = (text: string): boolean => WALLET.test(text.trim());

/** The view the wallet returns an owner to, with their address after it: `#connected/0x…`. */
export const CONNECTED_VIEW = "connected";

/**
 * Where Connect wallet goes: the owner's wallet, asked to send them back here with its address.
 *
 * The wallet shows this page's host and asks before it sends anything; see the mandate's
 * `src/ui/connect.ts`. `null` where no wallet serves this network.
 */
export const connectUrl = (walletUrl: string | null, origin: string): string | null =>
  walletUrl === null ? null : `${walletUrl}connect?return=${encodeURIComponent(`${origin}/#${CONNECTED_VIEW}/`)}`;

function read(): string | null {
  try {
    const kept = localStorage.getItem(KEY);
    return kept !== null && isWallet(kept) ? kept : null;
  } catch {
    return null;
  }
}

export interface OwnerWallet {
  /** The wallet this browser is connected to, or `null`. */
  readonly owner: string | null;
  readonly remember: (wallet: string) => void;
  readonly forget: () => void;
  /** Where Connect wallet goes, or `null` where there is no wallet to connect. */
  readonly connectHref: string | null;
}

/**
 * The owner's wallet, as this browser last connected it.
 *
 * Kept so every screen can show whose agents it is about, and so the owner's page is one click away.
 * Only a convenience: storage a browser refuses, or clears, costs a reconnect, and the page itself is
 * always reachable by its link.
 */
export function useOwnerWallet(walletUrl: string | null): OwnerWallet {
  const [owner, setOwner] = useState<string | null>(read);
  const remember = useCallback((next: string) => {
    if (!isWallet(next)) return;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Not kept; this visit still knows it.
    }
    setOwner(next);
  }, []);
  const forget = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing was kept to remove.
    }
    setOwner(null);
  }, []);
  return { owner, remember, forget, connectHref: connectUrl(walletUrl, window.location.origin) };
}
