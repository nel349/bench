import { expect, test, describe as suite } from "bun:test";
import { describe, type Allowance } from "./allowance.ts";
import { usdc, format } from "../money.ts";

const NOW = 1_700_000_000;
const info = (over: Partial<{ hasLimit: boolean; limit: bigint; limitUsed: bigint; refreshInterval: number; lastUsedTime: number }> = {}) => ({
  hasLimit: true, limit: usdc("5"), limitUsed: 0n, refreshInterval: 0, lastUsedTime: 0, ...over,
});

suite("what is left", () => {
  test("an untouched allowance has all of it", () => {
    const a = describe(info(), 0, NOW);
    expect(format(a.remaining)).toBe(format(usdc("5")));
    expect(a.live).toBe(true);
  });

  test("spending comes off it exactly", () => {
    const a = describe(info({ limitUsed: usdc("1.37") }), 0, NOW);
    expect(format(a.remaining)).toBe(format(usdc("3.63")));
  });

  test("a fully spent allowance is not live, and is zero rather than negative", () => {
    const a = describe(info({ limitUsed: usdc("5") }), 0, NOW);
    expect(a.remaining).toBe(0n);
    expect(a.live).toBe(false);
  });

  /**
   * A limit lowered after it had been partly spent leaves `used` above `limit`. Subtracting without
   * flooring gives a negative number, which reads as credit — the one wrong answer that would let an
   * agent think it could spend when the chain will refuse it.
   */
  test("a limit lowered below what was already spent is zero, never credit", () => {
    const a = describe(info({ limit: usdc("1"), limitUsed: usdc("5") }), 0, NOW);
    expect(a.remaining).toBe(0n);
    expect(a.remaining >= 0n).toBe(true);
    expect(a.live).toBe(false);
  });
});

suite("whether it could pay right now", () => {
  test("no limit set means it cannot spend this token at all", () => {
    expect(describe(info({ hasLimit: false }), 0, NOW).live).toBe(false);
  });

  test("an expiry in the past kills it, however much is left", () => {
    const a = describe(info(), NOW - 1, NOW);
    expect(format(a.remaining)).toBe(format(usdc("5")));
    expect(a.live).toBe(false);
  });

  test("an expiry in the future does not", () => {
    expect(describe(info(), NOW + 3600, NOW).live).toBe(true);
  });

  test("zero means no expiry was set, not expired at the epoch", () => {
    expect(describe(info(), 0, NOW).live).toBe(true);
  });

  test("the expiry second itself is still live", () => {
    expect(describe(info(), NOW, NOW).live).toBe(true);
  });
});

suite("what it reports", () => {
  test("the refresh interval comes through as seconds", () => {
    expect(describe(info({ refreshInterval: 86400 }), 0, NOW).refreshInterval).toBe(86400);
  });

  test("money stays a bigint all the way through, never a float", () => {
    const a: Allowance = describe(info({ limit: usdc("0.30"), limitUsed: usdc("0.10") }), 0, NOW);
    expect(typeof a.remaining).toBe("bigint");
    expect(format(a.remaining)).toBe("0.200000");
  });
});
