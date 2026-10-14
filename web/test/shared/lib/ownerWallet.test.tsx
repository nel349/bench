import { beforeEach, describe, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { CONNECT_FOR_MS, useOwnerWallet } from "../../../src/shared/lib/ownerWallet.ts";
import { onNetwork } from "../../strings.tsx";
import { TESTNET } from "../../network.ts";

const W1 = "0x9fa928ACfE2eEcEad9698ebBad835E7129688b28";
const W2 = "0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce";
const W3 = "0x00000000000000000000000000000000000000Aa";
const WALLET = "bench.owner.wallet";
const DECLINED = "bench.owner.declined";
const CONNECTING = "bench.owner.connecting";

/** This test environment has no working localStorage; a browser's is a map of strings like this one. */
let kept: Map<string, string>;
beforeEach(() => {
  kept = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  });
});
const wallet = () => renderHook(() => useOwnerWallet(), { wrapper: onNetwork(TESTNET) });
/** Back from the wallet after Connect wallet was pressed here: the one answer that was asked for. */
const askedFor = (hook: ReturnType<typeof wallet>, answer: string) => {
  act(() => hook.result.current.beginConnect());
  act(() => hook.result.current.returned(answer));
};

describe("a wallet typed or pasted here", () => {
  test("is connected, kept, and found again on the next visit", () => {
    const first = wallet();
    act(() => first.result.current.connect(W1));
    expect(first.result.current.owner).toBe(W1);
    expect(wallet().result.current.owner).toBe(W1);
  });

  /** With one connected, pasting another and pressing Open did nothing, and said nothing. */
  test("replaces the one that was connected, because the owner said so in as many words", () => {
    const { result } = wallet();
    act(() => result.current.connect(W1));
    act(() => result.current.connect(W2));
    expect(result.current.owner).toBe(W2);
    expect(kept.get(WALLET)).toBe(W2);
  });

  test("ends any asking that was standing, since the owner has now said which wallet in person", () => {
    const { result } = wallet();
    act(() => result.current.beginConnect());
    act(() => result.current.connect(W1));
    expect(kept.has(CONNECTING)).toBe(false);
    // So a link of the wallet's shape, arriving after, is only a link.
    act(() => result.current.returned(W2));
    expect(result.current.owner).toBe(W1);
  });

  /** It was checked trimmed and kept untrimmed, and the page then asked the gym for an address with a space in it. */
  test("is kept without the space it arrived with, and anything that is not an address is not kept", () => {
    const { result } = wallet();
    act(() => result.current.connect("not a wallet"));
    expect(result.current.owner).toBeNull();
    act(() => result.current.connect(`${W1} `));
    expect(result.current.owner).toBe(W1);
  });
});

describe("a wallet that arrives by a link", () => {
  test("is connected when its page is opened and none is", () => {
    const { result } = wallet();
    act(() => result.current.offer(W1));
    expect(result.current.owner).toBe(W1);
  });

  /** A link, opened while connected, swapped whose agents "Your agents" meant. */
  test("does not replace a connected one, whether it is a page or shaped like the wallet's answer", () => {
    const { result } = wallet();
    act(() => result.current.connect(W1));
    act(() => result.current.offer(W2));
    act(() => result.current.returned(W2));
    expect(result.current.owner).toBe(W1);
  });

  /**
   * Disconnect did not hold. The page still open offered the same wallet straight back; and an old
   * link of the shape the wallet returns, opened unasked, connected it again and forgot the decline.
   */
  test("does not bring back a wallet the owner disconnected from, by either shape, on this visit or the next", () => {
    const { result } = wallet();
    act(() => result.current.connect(W1));
    act(() => result.current.forget());
    expect(result.current.owner).toBeNull();
    act(() => result.current.offer(W1.toLowerCase()));
    act(() => result.current.returned(W1));
    expect(result.current.owner).toBeNull();
    const later = wallet();
    act(() => later.result.current.offer(W1));
    act(() => later.result.current.returned(W1));
    expect(later.result.current.owner).toBeNull();
    // Another wallet's page is still offered.
    act(() => later.result.current.offer(W2));
    expect(later.result.current.owner).toBe(W2);
  });

  /** Only the last one was remembered: disconnecting from a second forgot the first. */
  test("does not bring back any of several wallets disconnected from", () => {
    const { result } = wallet();
    for (const each of [W1, W2, W3]) {
      act(() => result.current.connect(each));
      act(() => result.current.forget());
    }
    for (const each of [W1, W2, W3]) {
      act(() => result.current.offer(each));
      expect(result.current.owner).toBeNull();
    }
  });

  test("remembers the twenty most lately disconnected from, and no more", () => {
    const { result } = wallet();
    const many = Array.from({ length: 23 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}`);
    for (const each of many) {
      act(() => result.current.connect(each));
      act(() => result.current.forget());
    }
    const declined = JSON.parse(kept.get(DECLINED)!) as string[];
    expect(declined).toHaveLength(20);
    expect(declined[0]).toBe(many[22]);
    // The oldest three have dropped off the end, and their pages are offered again.
    act(() => result.current.offer(many[0]!));
    expect(result.current.owner).toBe(many[0]);
  });

  test("reads a kept list that has rubbish in it for the addresses it does hold", () => {
    kept.set(DECLINED, JSON.stringify([7, null, "not an address", W1.toUpperCase().replace("0X", "0x"), { w: W2 }]));
    const { result } = wallet();
    act(() => result.current.offer(W1));
    expect(result.current.owner).toBeNull();
    act(() => result.current.offer(W2));
    expect(result.current.owner).toBe(W2);
  });

  test("honours a disconnect kept by an earlier version, as one address and not a list", () => {
    kept.set(DECLINED, W1);
    const { result } = wallet();
    act(() => result.current.offer(W1));
    expect(result.current.owner).toBeNull();
  });

  test("a disconnected wallet comes back when its owner asks for it: typed, or by Connect wallet", () => {
    const typed = wallet();
    act(() => typed.result.current.connect(W1));
    act(() => typed.result.current.forget());
    act(() => typed.result.current.connect(W1));
    expect(typed.result.current.owner).toBe(W1);
    // And it is no longer one they disconnected from: disconnect another, and the first's page is still offered.
    act(() => typed.result.current.connect(W2));
    act(() => typed.result.current.forget());
    act(() => typed.result.current.offer(W1));
    expect(typed.result.current.owner).toBe(W1);

    act(() => typed.result.current.forget());
    askedFor(typed, W1);
    expect(typed.result.current.owner).toBe(W1);
  });
});

describe("the wallet's answer to Connect wallet", () => {
  /**
   * Two tabs. One connected A while the other still showed Connect wallet; pressing it there and
   * choosing B came back to a browser that already held A, and B was dropped without a word.
   */
  test("replaces what another tab connected, and is used up by being answered", () => {
    const hook = wallet();
    act(() => hook.result.current.beginConnect());
    kept.set(WALLET, W1);
    act(() => hook.result.current.returned(W2));
    expect(hook.result.current.owner).toBe(W2);
    expect(kept.get(WALLET)).toBe(W2);
    // A second answer, arriving unasked, changes nothing.
    act(() => hook.result.current.returned(W1));
    expect(hook.result.current.owner).toBe(W2);
  });

  test("that was cancelled is over: a later answer is not taken as its answer", () => {
    const { result } = wallet();
    act(() => result.current.connect(W1));
    act(() => result.current.beginConnect());
    act(() => result.current.returned(""));
    expect(kept.has(CONNECTING)).toBe(false);
    act(() => result.current.returned(W2));
    expect(result.current.owner).toBe(W1);
  });

  test("is not one that arrives long after Connect wallet was pressed", () => {
    const { result } = wallet();
    act(() => result.current.connect(W1));
    kept.set(CONNECTING, String(Date.now() - CONNECT_FOR_MS - 1));
    act(() => result.current.returned(W2));
    expect(result.current.owner).toBe(W1);
  });

  /** A clock set back since left the asking standing until something used it. */
  test("is not one whose asking is timed in the future", () => {
    const { result } = wallet();
    act(() => result.current.connect(W1));
    kept.set(CONNECTING, String(Date.now() + 60 * 60 * 1000));
    act(() => result.current.returned(W2));
    expect(result.current.owner).toBe(W1);
    expect(kept.has(CONNECTING)).toBe(false);
  });
});

describe("two tabs", () => {
  /** The rule was checked against what the tab loaded with, so a stale tab wrote over another's wallet. */
  test("a tab that loaded before another connected a wallet does not write over it, by either kind of link", () => {
    const stale = wallet();
    kept.set(WALLET, W1);
    act(() => stale.result.current.offer(W2));
    expect(kept.get(WALLET)).toBe(W1);
    expect(stale.result.current.owner).toBe(W1);

    const other = wallet();
    kept.set(WALLET, W3);
    act(() => other.result.current.returned(W2));
    expect(kept.get(WALLET)).toBe(W3);
    expect(other.result.current.owner).toBe(W3);
  });

  test("a change made in another tab is followed in this one", () => {
    const { result } = wallet();
    kept.set(WALLET, W1);
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: WALLET })); });
    expect(result.current.owner).toBe(W1);
    kept.delete(WALLET);
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: null })); });
    expect(result.current.owner).toBeNull();
  });

  /** A page brought back by the Back button is the page as it was left; no storage event comes for it. */
  test("a page brought back by the Back button shows what is connected now", () => {
    const { result } = wallet();
    act(() => result.current.connect(W1));
    kept.set(WALLET, W2);
    act(() => { window.dispatchEvent(new Event("pageshow")); });
    expect(result.current.owner).toBe(W2);
  });

  test("disconnecting in a stale tab declines the wallet that is connected now, not the one it loaded with", () => {
    const { result } = wallet();
    act(() => result.current.connect(W1));
    kept.set(WALLET, W2);
    act(() => result.current.forget());
    expect(JSON.parse(kept.get(DECLINED)!)).toEqual([W2.toLowerCase()]);
    expect(kept.has(WALLET)).toBe(false);
  });
});

describe("a browser whose storage refuses", () => {
  const refusing = (over: Partial<Storage>) => vi.stubGlobal("localStorage", {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
    ...over,
  });

  /**
   * A private window that throws on every call. It read as "nothing kept", so every rule about what
   * was connected and what was disconnected stopped applying: a link replaced the connected wallet,
   * and a wallet just disconnected was reconnected by its own page.
   */
  test("that throws on every call keeps the same rules for the visit", () => {
    const blocked = () => { throw new Error("blocked"); };
    refusing({ getItem: blocked, setItem: blocked, removeItem: blocked });
    const { result } = wallet();
    act(() => result.current.connect(W1));
    expect(result.current.owner).toBe(W1);
    act(() => result.current.offer(W2));
    expect(result.current.owner).toBe(W1);
    act(() => result.current.forget());
    expect(result.current.owner).toBeNull();
    act(() => result.current.offer(W1));
    expect(result.current.owner).toBeNull();
    act(() => result.current.offer(W2));
    expect(result.current.owner).toBe(W2);
  });

  /** Full, so it reads and will not write. What it read was stale, and this tab's own wallet was hidden from the rules. */
  test("that reads but will not write keeps the same rules for the visit", () => {
    refusing({ setItem: () => { throw new Error("quota"); } });
    const { result } = wallet();
    act(() => result.current.connect(W1));
    expect(result.current.owner).toBe(W1);
    act(() => result.current.offer(W2));
    expect(result.current.owner).toBe(W1);
    act(() => result.current.forget());
    act(() => result.current.offer(W1));
    expect(result.current.owner).toBeNull();
  });

  /**
   * The moment it starts refusing, this tab goes by its own copy. That copy has to begin from what
   * the browser holds, not from nothing: begun from nothing, the wallet already connected was not
   * there, and a link replaced it.
   */
  test("that starts refusing part-way still knows what was connected and what was disconnected", () => {
    kept.set(WALLET, W1);
    kept.set(DECLINED, JSON.stringify([W3.toLowerCase()]));
    refusing({ setItem: () => { throw new Error("quota"); } });
    const { result } = wallet();
    // The first write to be refused is the one that begins it.
    act(() => result.current.beginConnect());
    act(() => result.current.returned(""));
    act(() => result.current.offer(W2));
    expect(result.current.owner).toBe(W1);
    act(() => result.current.forget());
    act(() => result.current.offer(W3));
    expect(result.current.owner).toBeNull();
  });

  /** Begun from this tab's own old writes, a wallet another tab had since disconnected came back. */
  test("that starts refusing part-way goes by what another tab did last, not by what this one wrote before", () => {
    let full = false;
    refusing({ setItem: (key: string, value: string) => { if (full) throw new Error("quota"); kept.set(key, value); } });
    const { result } = wallet();
    act(() => result.current.connect(W1));
    // Another tab disconnects it, and this one follows.
    kept.delete(WALLET);
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: WALLET })); });
    expect(result.current.owner).toBeNull();
    full = true;
    act(() => result.current.beginConnect());
    act(() => { window.dispatchEvent(new Event("pageshow")); });
    expect(result.current.owner).toBeNull();
  });

  test("that will not be read at all goes by what this tab wrote", () => {
    refusing({ getItem: () => { throw new Error("blocked"); } });
    const { result } = wallet();
    act(() => result.current.connect(W1));
    expect(result.current.owner).toBe(W1);
    act(() => result.current.offer(W2));
    expect(result.current.owner).toBe(W1);
  });

  /**
   * Full: it reads and removes and will not take a new value. Disconnect wrote the list of wallets
   * disconnected from first, was refused, and never got to taking the wallet away, so this tab
   * showed nothing connected while the next visit, and every other tab, still had it.
   */
  test("that is full still lets go of a wallet its owner disconnects from", () => {
    kept.set(WALLET, W1);
    refusing({ setItem: () => { throw new Error("quota"); } });
    const { result } = wallet();
    act(() => result.current.forget());
    expect(result.current.owner).toBeNull();
    expect(kept.has(WALLET)).toBe(false);
    // The next visit reads the browser afresh.
    expect(wallet().result.current.owner).toBeNull();
  });

  test("that refused once and then works again is written to again", () => {
    let refusals = 1;
    refusing({ setItem: (key: string, value: string) => { if (refusals-- > 0) throw new Error("busy"); kept.set(key, value); } });
    const { result } = wallet();
    act(() => result.current.beginConnect());
    act(() => result.current.connect(W1));
    expect(kept.get(WALLET)).toBe(W1);
    expect(wallet().result.current.owner).toBe(W1);
  });

  /** It worked, was written to, and then would not be read. What this tab wrote is all there is to go by. */
  test("that worked and then will not be read goes by what this tab wrote while it did", () => {
    let blocked = false;
    refusing({ getItem: (key: string) => { if (blocked) throw new Error("blocked"); return kept.get(key) ?? null; } });
    const { result } = wallet();
    act(() => result.current.connect(W1));
    blocked = true;
    act(() => { window.dispatchEvent(new Event("pageshow")); });
    expect(result.current.owner).toBe(W1);
    act(() => result.current.offer(W2));
    expect(result.current.owner).toBe(W1);
  });

  test("that held a wallet before it began refusing still shows it", () => {
    kept.set(WALLET, W1);
    refusing({ setItem: () => { throw new Error("quota"); } });
    const { result } = wallet();
    expect(result.current.owner).toBe(W1);
    act(() => result.current.beginConnect());
    act(() => result.current.returned(W2));
    expect(result.current.owner).toBe(W2);
  });
});
