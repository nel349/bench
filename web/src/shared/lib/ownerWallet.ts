import { useCallback, useEffect, useRef, useState } from "react";

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

/**
 * What this browser has kept: a wallet, `null` for none, or `undefined` where storage will not say.
 * Read at the moment of each decision, because another tab may have changed it since this one loaded.
 */
function stored(): string | null | undefined {
  try {
    const kept = localStorage.getItem(KEY);
    return kept !== null && isWallet(kept) ? kept : null;
  } catch {
    return undefined;
  }
}

/** The wallet an owner disconnected from, so opening its page again does not quietly reconnect it. */
const DECLINED = "bench.owner.declined";
/** When Connect wallet was last pressed here, so the wallet's answer is known to have been asked for. */
const CONNECTING = "bench.owner.connecting";
/** How long after pressing Connect wallet an answer still counts as the answer to it. */
export const CONNECT_FOR_MS = 30 * 60 * 1000;

function kept(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export interface OwnerWallet {
  /** The wallet this browser is connected to, or `null`. */
  readonly owner: string | null;
  /**
   * Connect a wallet its owner asked for: back from the wallet's Connect, or typed in by hand. When
   * Connect wallet was pressed here a moment ago it replaces whatever was connected. Otherwise it
   * does nothing while another is connected, so a link of the same shape cannot swap whose agents
   * "Your agents" means. Called with whatever came back, an empty answer included, so a cancelled
   * Connect is over too.
   */
  readonly remember: (wallet: string) => void;
  /**
   * Connect a wallet because its page was opened, the way an agent's link to its owner works. Does
   * nothing while one is connected, or for the wallet the owner last disconnected from.
   */
  readonly offer: (wallet: string) => void;
  readonly forget: () => void;
  /** Note that Connect wallet was pressed, on the way out to the wallet. */
  readonly beginConnect: () => void;
  /** Where Connect wallet goes, or `null` where there is no wallet to connect. */
  readonly connectHref: string | null;
}

/**
 * The owner's wallet, as this browser last connected it.
 *
 * Kept so every screen can show whose agents it is about, and so the owner's page is one click away.
 * Only a convenience: storage a browser refuses, or clears, costs a reconnect, and the page itself is
 * always reachable by its link. Shared by every tab: a change in one is seen by the others.
 */
export function useOwnerWallet(walletUrl: string | null): OwnerWallet {
  const [owner, setOwner] = useState<string | null>(() => stored() ?? null);
  // What this tab last knew, for a browser whose storage will not say.
  const known = useRef(owner);
  const connected = useCallback(() => {
    const now = stored();
    return now === undefined ? known.current : now;
  }, []);
  const show = useCallback((next: string | null) => { known.current = next; setOwner(next); }, []);
  const keep = useCallback((next: string | null, wasDeclined: string | null) => {
    try {
      if (next === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, next);
      if (wasDeclined === null) localStorage.removeItem(DECLINED); else localStorage.setItem(DECLINED, wasDeclined);
      localStorage.removeItem(CONNECTING);
    } catch {
      // Not kept; this visit still knows it.
    }
    show(next);
  }, [show]);

  useEffect(() => {
    // Another tab connected or disconnected: this one follows, rather than acting on what it loaded with.
    const follow = (event: StorageEvent) => {
      if (event.key !== null && event.key !== KEY) return;
      const now = stored();
      if (now !== undefined) show(now);
    };
    window.addEventListener("storage", follow);
    return () => window.removeEventListener("storage", follow);
  }, [show]);

  const remember = useCallback((next: string) => {
    const wallet = next.trim();
    // The asking is used up by any answer, an empty one from a cancelled Connect included: left
    // standing, it would let a link of the same shape swap the wallet for the next half hour.
    const asked = Date.now() - Number(kept(CONNECTING) ?? 0) < CONNECT_FOR_MS;
    try { localStorage.removeItem(CONNECTING); } catch { /* nothing was kept to use up */ }
    if (!isWallet(wallet)) return;
    const now = connected();
    if (now !== null && !asked) { show(now); return; }
    keep(wallet, null);
  }, [connected, keep, show]);
  const offer = useCallback((next: string) => {
    const wallet = next.trim();
    const now = connected();
    if (now !== null) { show(now); return; }
    if (!isWallet(wallet) || kept(DECLINED)?.toLowerCase() === wallet.toLowerCase()) return;
    keep(wallet, null);
  }, [connected, keep, show]);
  const forget = useCallback(() => keep(null, connected()), [connected, keep]);
  const beginConnect = useCallback(() => {
    try {
      localStorage.setItem(CONNECTING, String(Date.now()));
    } catch {
      // Not kept: the answer then connects only if nothing else is connected.
    }
  }, []);
  return { owner, remember, offer, forget, beginConnect, connectHref: connectUrl(walletUrl, window.location.origin) };
}
