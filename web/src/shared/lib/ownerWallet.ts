import { useCallback, useEffect, useState } from "react";

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

/** The wallet this browser is connected to. */
const KEY_WALLET = KEY;
/** The wallets an owner disconnected from, so opening one's page again does not quietly reconnect it. */
const DECLINED = "bench.owner.declined";
/** When Connect wallet was last pressed here, so the wallet's answer is known to have been asked for. */
const CONNECTING = "bench.owner.connecting";
/** How long after pressing Connect wallet an answer still counts as the answer to it. */
export const CONNECT_FOR_MS = 30 * 60 * 1000;
/** How many disconnected wallets are remembered. One was not enough: the second forgot the first. */
const DECLINED_KEPT = 20;

/**
 * What this browser keeps, with somewhere to keep it when the browser will not.
 *
 * The browser's storage is the truth while it works, because every tab shares it. When it refuses,
 * a private window that throws on every call or one that is full and will not take a write, the
 * same rules still have to hold for this visit, so from the first refusal this tab keeps its own
 * copy and reads that. It used to read "nothing kept" there, and every rule about what is
 * connected and what was disconnected quietly stopped applying.
 */
interface Kept {
  read(key: string): string | null;
  write(key: string, value: string | null): void;
}

function keptHere(): Kept {
  const own = new Map<string, string>();
  let refused = false;
  /**
   * From now on this tab's own copy is read. It is brought up to what the browser will still say,
   * key by key, because another tab may have changed things since this one last wrote them: begun
   * from this tab's old writes, a wallet disconnected elsewhere came back. Only a key the browser
   * will not read is left as this tab last wrote it.
   */
  const refuse = () => {
    if (refused) return;
    refused = true;
    for (const key of [KEY_WALLET, DECLINED, CONNECTING]) {
      try {
        const there = localStorage.getItem(key);
        if (there === null) own.delete(key); else own.set(key, there);
      } catch { /* it will not say; what this tab last wrote stands */ }
    }
  };
  return {
    read(key) {
      if (!refused) {
        try { return localStorage.getItem(key); } catch { refuse(); }
      }
      return own.get(key) ?? null;
    },
    write(key, value) {
      // Tried every time, refused before or not. A browser that is full will not take a new value
      // and will still take a removal, and giving up on it after one refusal left a wallet the
      // owner had just disconnected from connected for the next visit and for every other tab.
      try {
        if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
      } catch { refuse(); }
      // To the tab's own copy either way: it is what is read once the browser refuses, and after a
      // refusal it has just been brought up to date, so this write lands on top of the truth.
      if (value === null) own.delete(key); else own.set(key, value);
    },
  };
}

const walletIn = (kept: Kept): string | null => {
  const there = kept.read(KEY_WALLET);
  return there !== null && isWallet(there) ? there : null;
};

/** The wallets disconnected from, lower case. One address alone is how it was kept before there could be several. */
function declinedIn(kept: Kept): readonly string[] {
  const there = kept.read(DECLINED);
  if (there === null) return [];
  try {
    const list: unknown = JSON.parse(there);
    if (Array.isArray(list)) return list.filter((w): w is string => typeof w === "string" && isWallet(w)).map((w) => w.toLowerCase());
  } catch { /* not a list: the single address of the older shape */ }
  return isWallet(there) ? [there.toLowerCase()] : [];
}

export interface OwnerWallet {
  /** The wallet this browser is connected to, or `null`. */
  readonly owner: string | null;
  /**
   * Connect a wallet its owner typed or pasted here. That is the owner saying so in as many words,
   * so it connects, in place of whatever was connected, and is no longer one they disconnected from.
   */
  readonly connect: (wallet: string) => void;
  /**
   * Take what came back from the wallet's Connect, an empty answer included. If Connect wallet was
   * pressed here in the last half hour it is the answer to that: it connects, in place of whatever
   * was connected, and the asking is used up whatever the answer was. If it was not, this is only a
   * link of the same shape, and is treated as `offer` treats one.
   */
  readonly returned: (answer: string) => void;
  /**
   * Connect a wallet because its page was opened, the way an agent's link to its owner works. Does
   * nothing while one is connected, or for a wallet the owner disconnected from.
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
 *
 * Three ways a wallet arrives, in order of how plainly it was asked for. Typed here: it connects.
 * Back from the wallet after Connect wallet was pressed here: it connects. By a link, to a page or
 * of the shape the wallet returns: it connects only where nothing is connected and the owner has
 * not disconnected from it, so a link can never change whose agents "Your agents" means or undo a
 * Disconnect.
 */
export function useOwnerWallet(walletUrl: string | null): OwnerWallet {
  const [kept] = useState(keptHere);
  const [owner, setOwner] = useState<string | null>(() => walletIn(kept));
  /** Show what is kept now, which another tab may have changed since this one last looked. */
  const sync = useCallback(() => setOwner(walletIn(kept)), [kept]);

  useEffect(() => {
    // Another tab connected or disconnected: this one follows, rather than acting on what it loaded with.
    const follow = (event: StorageEvent) => { if (event.key === null || event.key === KEY_WALLET) sync(); };
    window.addEventListener("storage", follow);
    // A page brought back by the Back button is the page as it was left, and no storage event comes
    // for what happened while it was away.
    window.addEventListener("pageshow", sync);
    return () => {
      window.removeEventListener("storage", follow);
      window.removeEventListener("pageshow", sync);
    };
  }, [sync]);

  const take = useCallback((wallet: string) => {
    kept.write(KEY_WALLET, wallet);
    const others = declinedIn(kept).filter((w) => w !== wallet.toLowerCase());
    kept.write(DECLINED, others.length === 0 ? null : JSON.stringify(others));
    sync();
  }, [kept, sync]);

  const offer = useCallback((next: string) => {
    const wallet = next.trim();
    const open = walletIn(kept) === null && isWallet(wallet) && !declinedIn(kept).includes(wallet.toLowerCase());
    if (open) take(wallet); else sync();
  }, [kept, take, sync]);

  const connect = useCallback((next: string) => {
    const wallet = next.trim();
    kept.write(CONNECTING, null);
    if (isWallet(wallet)) take(wallet); else sync();
  }, [kept, take, sync]);

  const returned = useCallback((answer: string) => {
    // Pressed here, and not long ago. A time ahead of now is a clock that was set back since, and is
    // not an asking that lasts until it is used.
    const since = Date.now() - Number(kept.read(CONNECTING) ?? Number.NaN);
    const asked = since >= 0 && since < CONNECT_FOR_MS;
    // Used up by any answer, an empty one from a cancelled Connect included: left standing, it would
    // let a link of the same shape swap the wallet for the next half hour.
    kept.write(CONNECTING, null);
    if (asked) connect(answer); else offer(answer);
  }, [kept, connect, offer]);

  const forget = useCallback(() => {
    const now = walletIn(kept);
    // Taken away first. It is the part that must not fail, and a removal is what a browser that
    // is full will still do.
    kept.write(KEY_WALLET, null);
    kept.write(CONNECTING, null);
    if (now !== null) {
      const declined = [now.toLowerCase(), ...declinedIn(kept).filter((w) => w !== now.toLowerCase())];
      kept.write(DECLINED, JSON.stringify(declined.slice(0, DECLINED_KEPT)));
    }
    sync();
  }, [kept, sync]);

  const beginConnect = useCallback(() => kept.write(CONNECTING, String(Date.now())), [kept]);

  return { owner, connect, returned, offer, forget, beginConnect, connectHref: connectUrl(walletUrl, window.location.origin) };
}
