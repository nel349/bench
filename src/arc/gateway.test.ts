import { expect, test, describe, afterEach } from "bun:test";
import { GatewayFacilitator, GATEWAY_API } from "./gateway.ts";
import type { PaymentPayload, PaymentRequirements } from "./facilitator.ts";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; delete process.env["GATEWAY_API"]; });

interface Seen { url: string; init: RequestInit }
const seen: Seen[] = [];

/** Stands in for Gateway. Nothing in this file reaches the network. */
function answering(body: unknown, status = 200, raw?: string) {
  seen.length = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} });
    return new Response(raw ?? JSON.stringify(body), { status });
  }) as typeof fetch;
}

const payload: PaymentPayload = {
  x402Version: 2, scheme: "exact", network: "eip155:5042002", resource: { url: "/attempts/a1/ask", description: "One probe", mimeType: "application/json" },
  accepted: { amount: "20000" }, payload: { authorization: { from: "0xabc" }, signature: "0xsig" },
};
const requirements = {
  scheme: "exact", network: "eip155:5042002", asset: "0x3600000000000000000000000000000000000000",
  amount: 20000n as unknown as string, payTo: "0xbe", maxTimeoutSeconds: 604800,
  extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077" },
} as unknown as PaymentRequirements;

const body = () => JSON.parse(String(seen[0]!.init.body));

describe("where it sends", () => {
  test("testnet and mainnet have different hosts, which is a trap worth pinning", () => {
    expect(new GatewayFacilitator("testnet").endpoint).toBe(GATEWAY_API.testnet);
    expect(new GatewayFacilitator("mainnet").endpoint).toBe(GATEWAY_API.mainnet);
    expect(GATEWAY_API.testnet).not.toBe(GATEWAY_API.mainnet);
  });

  test("the environment overrides the default, for a local facilitator", () => {
    process.env["GATEWAY_API"] = "http://localhost:9999/";
    expect(new GatewayFacilitator("testnet").endpoint).toBe("http://localhost:9999");
  });

  test("a trailing slash never becomes a double slash in the path", async () => {
    answering({ isValid: true });
    await new GatewayFacilitator("testnet", { url: "https://x.test/" }).verify(payload, requirements);
    expect(seen[0]!.url).toBe("https://x.test/v1/x402/verify");
  });

  test("verify and settle are different endpoints", async () => {
    answering({ isValid: true });
    await new GatewayFacilitator("testnet").verify(payload, requirements);
    expect(seen[0]!.url).toEndWith("/v1/x402/verify");
    answering({ success: true });
    await new GatewayFacilitator("testnet").settle(payload, requirements);
    expect(seen[0]!.url).toEndWith("/v1/x402/settle");
  });
});

describe("what it sends", () => {
  test("both halves, under the names Gateway expects", async () => {
    answering({ isValid: true });
    await new GatewayFacilitator("testnet").verify(payload, requirements);
    expect(Object.keys(body()).sort()).toEqual(["paymentPayload", "paymentRequirements"]);
  });

  test("a bigint amount crosses as a string, because JSON cannot carry one", async () => {
    answering({ isValid: true });
    await new GatewayFacilitator("testnet").verify(payload, requirements);
    expect(body().paymentRequirements.amount).toBe("20000");
  });

  test("the extra block survives, since settlement depends on it", async () => {
    answering({ isValid: true });
    await new GatewayFacilitator("testnet").verify(payload, requirements);
    expect(body().paymentRequirements.extra.name).toBe("GatewayWalletBatched");
  });

  test("it is a POST with a JSON content type", async () => {
    answering({ isValid: true });
    await new GatewayFacilitator("testnet").verify(payload, requirements);
    expect(seen[0]!.init.method).toBe("POST");
    expect((seen[0]!.init.headers as Record<string, string>)["content-type"]).toContain("application/json");
  });

  test("supplied headers are sent, and the endpoint getter does not expose them", async () => {
    answering({ isValid: true });
    const f = new GatewayFacilitator("testnet", { headers: { authorization: "Bearer secret" } });
    await f.verify(payload, requirements);
    expect((seen[0]!.init.headers as Record<string, string>)["authorization"]).toBe("Bearer secret");
    expect(f.endpoint).not.toContain("secret");
  });

  test("it does not wait forever on a facilitator that hangs", async () => {
    answering({ isValid: true });
    await new GatewayFacilitator("testnet").verify(payload, requirements);
    expect(seen[0]!.init.signal).toBeDefined();
  });
});

describe("what it makes of the answer", () => {
  test("a verdict comes back whole, invalidReason included", async () => {
    answering({ isValid: false, invalidReason: "insufficient_funds", payer: "0xabc" });
    const r = await new GatewayFacilitator("testnet").verify(payload, requirements);
    expect(r).toMatchObject({ isValid: false, invalidReason: "insufficient_funds" });
  });

  test("a settlement comes back whole, transaction included", async () => {
    answering({ success: true, transaction: "0xdead", payer: "0xabc" });
    const r = await new GatewayFacilitator("testnet").settle(payload, requirements);
    expect(r).toMatchObject({ success: true, transaction: "0xdead" });
  });

  /**
   * A refusal carrying a proper body is the facilitator *answering*, even on a 4xx. Throwing there
   * would turn "your payment was declined" into "our service is down", which sends the agent to
   * check a wallet that is working exactly as told.
   */
  test("a 402 with a real verdict is an answer, not an outage", async () => {
    answering({ isValid: false, invalidReason: "expired" }, 402);
    const r = await new GatewayFacilitator("testnet").verify(payload, requirements);
    expect(r.isValid).toBe(false);
  });

  test("a response with no isValid throws, because it is not a verdict", async () => {
    answering({ something: "else" });
    expect(new GatewayFacilitator("testnet").verify(payload, requirements)).rejects.toThrow("isValid");
  });

  test("a response with no success throws", async () => {
    answering({ something: "else" });
    expect(new GatewayFacilitator("testnet").settle(payload, requirements)).rejects.toThrow("success");
  });

  test("an empty body throws rather than being read as a failed settlement", async () => {
    answering(null, 502, "");
    expect(new GatewayFacilitator("testnet").settle(payload, requirements)).rejects.toThrow("returned nothing");
  });

  test("an HTML error page from a proxy is not echoed into the message", async () => {
    answering(null, 502, "<html>Set-Cookie: session=abc123</html>");
    expect(new GatewayFacilitator("testnet").verify(payload, requirements))
      .rejects.toThrow(/not JSON/);
    await new GatewayFacilitator("testnet").verify(payload, requirements).catch((e: Error) => {
      expect(e.message).not.toContain("abc123");
    });
  });
});
