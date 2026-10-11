import { afterAll, beforeAll, expect, test, describe as suite } from "bun:test";
import { encodeAbiParameters, encodeFunctionResult, toFunctionSelector } from "viem";
import { ArcAllowances, SESSION_KEY_ABI, describe, type Allowance } from "../../src/chain/allowance.ts";

import { usdc, format } from "../../src/shared/money.ts";

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

/**
 * A node, stood in for, as in `registry.test.ts`: it answers each call the way a real one would in
 * the case under test, and the reading of those answers is the real code over real HTTP.
 *
 * The plugin's refusal is copied from Arc testnet, where it was asked on 10 October about a key an
 * account never granted: error `0xd3d0f659` carrying the key.
 */
suite("an allowance read from the plugin, and when it could not be read", () => {
  type Answer = { readonly result: string } | { readonly error: object } | { readonly status: number };
  let answer: (data: string) => Answer = () => ({ result: "0x" });
  let node: ReturnType<typeof Bun.serve>;
  const before = process.env["ARC_RPC_URL"];

  beforeAll(() => {
    node = Bun.serve({ port: 0, async fetch(req) {
      const call = await req.json() as { id: number; params: [{ data: string }] };
      const said = answer(call.params[0].data);
      if ("status" in said) return new Response("unavailable", { status: said.status });
      return Response.json({ jsonrpc: "2.0", id: call.id, ...said });
    } });
    process.env["ARC_RPC_URL"] = `http://127.0.0.1:${node.port}`;
  });
  afterAll(() => {
    void node.stop(true);
    if (before === undefined) delete process.env["ARC_RPC_URL"]; else process.env["ARC_RPC_URL"] = before;
  });

  const OWNER = "0x9fa928ACfE2eEcEad9698ebBad835E7129688b28";
  const AGENT = "0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce";
  const LIMIT_INFO = toFunctionSelector("getERC20SpendLimitInfo(address,address,address)");
  const NO_SUCH_KEY = `0xd3d0f659${encodeAbiParameters([{ type: "address" }], [AGENT]).slice(2)}`;
  const granted = (data: string): Answer => ({
    result: data.startsWith(LIMIT_INFO)
      ? encodeFunctionResult({
          abi: SESSION_KEY_ABI, functionName: "getERC20SpendLimitInfo",
          result: { hasLimit: true, limit: usdc("5"), limitUsed: usdc("0.38"), refreshInterval: 0, lastUsedTime: 0 },
        })
      : encodeFunctionResult({ abi: SESSION_KEY_ABI, functionName: "getKeyTimeRange", result: [0, 4_000_000_000] }),
  });

  test("what is left, when the plugin answers", async () => {
    answer = granted;
    const found = await new ArcAllowances("testnet").of(OWNER, AGENT);
    expect(found).not.toBeNull();
    expect(format(found!.remaining)).toBe(format(usdc("4.62")));
    expect(found!.live).toBe(true);
  });

  test("none, when the plugin itself refuses the key and says so", async () => {
    answer = () => ({ error: { code: 3, message: "execution reverted", data: NO_SUCH_KEY } });
    expect(await new ArcAllowances("testnet").of(OWNER, AGENT)).toBeNull();
  });

  test("none, for something that is not an address, without asking the chain", async () => {
    answer = () => { throw new Error("the chain was asked"); };
    expect(await new ArcAllowances("testnet").of("not-an-address", AGENT)).toBeNull();
  });

  /**
   * Read as "no allowance", a failing node told an owner their agent had none, and told an agent
   * asking what it had left that it had never been granted anything.
   */
  test("a node that is failing is a failure, not an agent with no allowance", async () => {
    answer = () => ({ error: { code: -32603, message: "Internal error" } });
    await expect(new ArcAllowances("testnet").of(OWNER, AGENT)).rejects.toThrow();
    answer = () => ({ status: 503 });
    await expect(new ArcAllowances("testnet").of(OWNER, AGENT)).rejects.toThrow();
  }, 30_000);

  /**
   * A node's own error can carry data too: a sentence, or nothing at all. It was read as the
   * contract's refusal because it was there, and an outage became "no allowance" again.
   */
  test("a node's error that carries words or an empty answer is still a failure", async () => {
    for (const data of ["upstream request timeout", "0x", "0x1234"]) {
      answer = () => ({ error: { code: -32603, message: "Internal error", data } });
      await expect(new ArcAllowances("testnet").of(OWNER, AGENT)).rejects.toThrow();
    }
  }, 60_000);

  test("one of the two reads failing is a failure too", async () => {
    answer = (data) => (data.startsWith(LIMIT_INFO) ? granted(data) : { error: { code: -32603, message: "Internal error" } });
    await expect(new ArcAllowances("testnet").of(OWNER, AGENT)).rejects.toThrow();
  }, 30_000);
});
