import { beforeEach, describe, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { CONNECT_FOR_MS, useOwnerWallet } from "../../../src/shared/lib/ownerWallet.ts";

const W1 = "0x9fa928ACfE2eEcEad9698ebBad835E7129688b28";
const W2 = "0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce";

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
const wallet = () => renderHook(() => useOwnerWallet("https://wallet.test/"));

describe("the wallet this browser is connected to", () => {
  test("back from the wallet's Connect, the address is kept, and found again on the next visit", () => {
    const first = wallet();
    act(() => first.result.current.remember(W1));
    expect(first.result.current.owner).toBe(W1);
    expect(wallet().result.current.owner).toBe(W1);
  });

  /** A link of the same shape, opened while connected, swapped whose agents "Your agents" meant. */
  test("a connected wallet is not replaced by another, whether returned or opened", () => {
    const { result } = wallet();
    act(() => result.current.remember(W1));
    act(() => result.current.remember(W2));
    act(() => result.current.offer(W2));
    expect(result.current.owner).toBe(W1);
  });

  test("a wallet whose page is opened is kept when none is connected", () => {
    const { result } = wallet();
    act(() => result.current.offer(W1));
    expect(result.current.owner).toBe(W1);
  });

  /** Disconnect did not hold: the page still open offered the same wallet straight back. */
  test("the wallet just disconnected is not offered back, but can be connected again by asking", () => {
    const { result } = wallet();
    act(() => result.current.remember(W1));
    act(() => result.current.forget());
    expect(result.current.owner).toBeNull();
    act(() => result.current.offer(W1.toLowerCase()));
    expect(result.current.owner).toBeNull();
    // On the next visit too.
    const later = wallet();
    act(() => later.result.current.offer(W1));
    expect(later.result.current.owner).toBeNull();
    // Another wallet's page is still offered, and Connect itself still connects the first.
    act(() => later.result.current.remember(W1));
    expect(later.result.current.owner).toBe(W1);
  });

  /**
   * Two tabs. One connected A while the other still showed Connect wallet; pressing it there and
   * choosing B came back to a browser that already held A, and B was dropped without a word.
   */
  test("the answer to a Connect wallet pressed here replaces what another tab connected", () => {
    const { result } = wallet();
    act(() => result.current.beginConnect());
    kept.set("bench.owner.wallet", W1);
    act(() => result.current.remember(W2));
    expect(result.current.owner).toBe(W2);
    expect(kept.get("bench.owner.wallet")).toBe(W2);
    // The asking is used up: a second answer, arriving unasked, changes nothing.
    act(() => result.current.remember(W1));
    expect(result.current.owner).toBe(W2);
  });

  test("a Connect wallet that was cancelled is over: a later answer is not taken as its answer", () => {
    const { result } = wallet();
    act(() => result.current.remember(W1));
    act(() => result.current.beginConnect());
    act(() => result.current.remember(""));
    expect(kept.has("bench.owner.connecting")).toBe(false);
    act(() => result.current.remember(W2));
    expect(result.current.owner).toBe(W1);
  });

  test("an answer that arrives long after Connect wallet was pressed is not taken as its answer", () => {
    const { result } = wallet();
    act(() => result.current.remember(W1));
    kept.set("bench.owner.connecting", String(Date.now() - CONNECT_FOR_MS - 1));
    act(() => result.current.remember(W2));
    expect(result.current.owner).toBe(W1);
  });

  /** The rule was checked against what the tab loaded with, so a stale tab wrote over another's wallet. */
  test("a tab that loaded before another connected a wallet does not write over it", () => {
    const stale = wallet();
    kept.set("bench.owner.wallet", W1);
    act(() => stale.result.current.offer(W2));
    expect(kept.get("bench.owner.wallet")).toBe(W1);
    expect(stale.result.current.owner).toBe(W1);
  });

  test("a change made in another tab is followed in this one", () => {
    const { result } = wallet();
    kept.set("bench.owner.wallet", W1);
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "bench.owner.wallet" })); });
    expect(result.current.owner).toBe(W1);
    kept.delete("bench.owner.wallet");
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: null })); });
    expect(result.current.owner).toBeNull();
  });

  test("disconnecting in a stale tab declines the wallet that is connected now, not the one it loaded with", () => {
    const { result } = wallet();
    act(() => result.current.remember(W1));
    kept.set("bench.owner.wallet", W2);
    act(() => result.current.forget());
    expect(kept.get("bench.owner.declined")).toBe(W2);
    expect(kept.has("bench.owner.wallet")).toBe(false);
  });

  /** It was checked trimmed and kept untrimmed, and the page then asked the gym for an address with a space in it. */
  test("an address is kept without the space it arrived with, and anything else is not kept", () => {
    const { result } = wallet();
    act(() => result.current.remember("not a wallet"));
    expect(result.current.owner).toBeNull();
    act(() => result.current.remember(`${W1} `));
    expect(result.current.owner).toBe(W1);
  });

  test("a browser that refuses storage still knows the wallet for this visit", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    });
    const { result } = wallet();
    act(() => result.current.remember(W1));
    expect(result.current.owner).toBe(W1);
    act(() => result.current.forget());
    expect(result.current.owner).toBeNull();
  });
});
