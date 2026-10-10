import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { sinceSummary, useLastVisit } from "../../src/yours/lastVisit.ts";

const WALLET = "0x9fa928ACfE2eEcEad9698ebBad835E7129688b28";
const KEY = `bench.owner.seen.${WALLET.toLowerCase()}`;

/** This test environment has no working localStorage; a browser's is a map of strings like this one. */
let kept: Map<string, string>;
beforeEach(() => {
  kept = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  });
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });

describe("when an owner last looked", () => {
  test("the first time there is no last time, and the page shown for a few seconds becomes it", () => {
    vi.setSystemTime(1_800_000_000_000);
    const { result } = renderHook(() => useLastVisit(WALLET, true));
    expect(result.current).toBeNull();
    vi.advanceTimersByTime(4_999);
    expect(kept.has(KEY)).toBe(false);
    vi.advanceTimersByTime(2);
    expect(Number(kept.get(KEY))).toBeGreaterThanOrEqual(1_800_000_000_000);
  });

  /** It was stamped five seconds after opening whatever happened, so a page that only failed hid the runs it never showed. */
  test("a page that never showed its agents was not looked at", () => {
    kept.set(KEY, "1700000000000");
    const { result, rerender } = renderHook(({ shown }) => useLastVisit(WALLET, shown), { initialProps: { shown: false } });
    expect(result.current).toBe(1_700_000_000_000);
    vi.advanceTimersByTime(60_000);
    expect(kept.get(KEY)).toBe("1700000000000");
    // Once it does show, the clock starts.
    rerender({ shown: true });
    vi.advanceTimersByTime(5_001);
    expect(kept.get(KEY)).not.toBe("1700000000000");
  });
});

describe("what happened since", () => {
  const run = (startedAt: number, paid: string, ranked = false) => ({ startedAt, paid, ranked });

  test("only runs started after the last look, their payments added exactly", () => {
    const runs = [run(100, "9.000000"), run(201, "0.100000"), run(202, "0.200000", true), run(203, "0.390000", true)];
    expect(sinceSummary(runs, 200)).toEqual({ runs: 3, spend: "0.690000", recorded: 2 });
  });

  test("nothing since is nothing", () => {
    expect(sinceSummary([run(100, "1.000000")], 200)).toEqual({ runs: 0, spend: "0.000000", recorded: 0 });
  });
});
