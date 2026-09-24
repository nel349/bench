import { expect, test, describe } from "bun:test";
import { parseAgentId, checkIdentity, type Registry } from "./identity.ts";
import { Attempts } from "../attempt.ts";
import { MemoryStore, SqliteStore, type Store } from "../store.ts";
import { ArcPayments } from "./payments.ts";
import { payloadFor } from "./buyer.ts";
import { b64, type Facilitator } from "./facilitator.ts";
import "../problems/blackbox-problem.ts";

const WALLET = "0xAbC0000000000000000000000000000000000001";
const OTHER = "0xDdD0000000000000000000000000000000000002";

/** The registry, scripted. Nothing here reaches a chain. */
const registryOf = (entries: Record<string, string>): Registry => ({
  async walletOf(id) { return (entries[id.toString()] ?? null) as `0x${string}` | null; },
  async ownerOf(id) { return (entries[id.toString()] ?? null) as `0x${string}` | null; },
});

describe("reading an id off a header", () => {
  test("a plain decimal id", () => expect(parseAgentId("42")).toBe(42n));
  test("whitespace is forgiven", () => expect(parseAgentId("  42 ")).toBe(42n));
  test("a uint256 far past Number.MAX_SAFE_INTEGER survives exactly", () => {
    const big = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    expect(parseAgentId(big)?.toString()).toBe(big);
  });
  test("zero is not an id", () => expect(parseAgentId("0")).toBe(null));
  test("nothing, junk, hex, negatives and decimals are all no claim", () => {
    for (const bad of [null, undefined, "", "abc", "0x2a", "-1", "4.2", "1e3", " "]) {
      expect(parseAgentId(bad as string | null)).toBe(null);
    }
  });
  test("an absurdly long string is refused before BigInt sees it", () => {
    expect(parseAgentId("9".repeat(500))).toBe(null);
  });
});

describe("checking a claim against the payer", () => {
  const registry = registryOf({ "42": WALLET });

  test("the id whose wallet paid is accepted", async () => {
    const r = await checkIdentity(registry, 42n, WALLET);
    expect(r.ok).toBe(true);
  });

  test("case does not matter: an address is an address", async () => {
    expect((await checkIdentity(registry, 42n, WALLET.toLowerCase())).ok).toBe(true);
  });

  test("another agent's id is refused, which is the whole point", async () => {
    const r = await checkIdentity(registry, 42n, OTHER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.because).toContain("not paid for by that address");
  });

  test("an unregistered id is refused and says so", async () => {
    const r = await checkIdentity(registry, 99n, WALLET);
    if (!r.ok) expect(r.because).toContain("not registered");
  });

  test("a payer that is not an address is refused, not thrown on", async () => {
    const r = await checkIdentity(registry, 42n, "not-an-address");
    expect(r.ok).toBe(false);
  });
});

/**
 * The claim, and what it takes to turn it into an identity.
 *
 * `X-Agent-Id` is free to send and `X-Agent` is free to send; a payment is not. So an id is only
 * promoted once the address that funds it has actually spent.
 */
describe("through a paid run", () => {
  const PAYER = WALLET;
  /** A well-formed payment, built the way a real buyer builds one. See `buyer.ts`. */
const TERMS = {
  scheme: "exact", network: "eip155:5042002",
  asset: "0x3600000000000000000000000000000000000000",
  amount: "20000", payTo: "0x000000000000000000000000000000000000bEEF",
  maxTimeoutSeconds: 604800,
  extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" },
} as const;

  const header = () => b64.encode(payloadFor(
    TERMS, { url: "/attempts/a1/ask", description: "One probe", mimeType: "application/json" },
    { from: PAYER as `0x${string}`, to: TERMS.payTo as `0x${string}`, value: TERMS.amount,
      validAfter: "0", validBefore: "99999999999", nonce: `0x${"11".repeat(32)}` },
    "0xsig",
  ));
  const facilitator: Facilitator = {
    async verify() { return { isValid: true, payer: PAYER }; },
    async settle() { return { success: true, payer: PAYER, transaction: "0xdead" }; },
  };
  const registry = registryOf({ "42": WALLET });
  const verifier = async (id: bigint, payer: string) => (await checkIdentity(registry, id, payer)).ok;

  const gym = (store: Store = new MemoryStore()) => new Attempts(
    new ArcPayments(facilitator, "testnet", "0xbe", () => 0n), store, verifier,
  );
  const probe = (a: Attempts, id: string) => a.ask(id, { side: "up", index: 0 }, header());

  test("a claim is recorded but unproven before anything is paid", () => {
    const at = gym().start("agent:aria", "blackbox", "7", null, 42n)!;
    expect(at.claimedId).toBe("42");
    expect(at.identity).toBe(null);
  });

  test("paying proves it", async () => {
    const a = gym();
    const at = a.start("agent:aria", "blackbox", "7", null, 42n)!;
    await probe(a, at.id);
    expect(a.get(at.id)!.identity).toBe("42");
  });

  test("claiming an id you do not fund leaves it unproven, and the run still stands", async () => {
    const a = new Attempts(
      new ArcPayments({
        async verify() { return { isValid: true, payer: OTHER }; },
        async settle() { return { success: true, payer: OTHER }; },
      }, "testnet", "0xbe", () => 0n), new MemoryStore(), verifier);
    const at = a.start("agent:thief", "blackbox", "7", null, 42n)!;
    await probe(a, at.id);
    const after = a.get(at.id)!;
    expect(after.identity).toBe(null);          // not promoted
    expect(after.payer).toBe(OTHER.toLowerCase()); // but still scored under who paid
    expect(after.probes).toHaveLength(1);       // and they got what they paid for
  });

  test("no claim means no identity, and no error", async () => {
    const a = gym();
    const at = a.start("agent:aria", "blackbox", "7")!;
    await probe(a, at.id);
    expect(a.get(at.id)!.identity).toBe(null);
  });

  test("a registry that throws does not take a paid run down with it", async () => {
    const a = new Attempts(
      new ArcPayments(facilitator, "testnet", "0xbe", () => 0n), new MemoryStore(),
      async () => { throw new Error("rpc is down"); });
    const at = a.start("agent:aria", "blackbox", "7", null, 42n)!;
    const out = await probe(a, at.id);
    expect("answer" in out).toBe(true);
    expect(a.get(at.id)!.identity).toBe(null);
  });

  test("with no verifier at all, a claim stays a claim", async () => {
    const a = new Attempts(new ArcPayments(facilitator, "testnet", "0xbe", () => 0n), new MemoryStore());
    const at = a.start("agent:aria", "blackbox", "7", null, 42n)!;
    await probe(a, at.id);
    expect(a.get(at.id)!.claimedId).toBe("42");
    expect(a.get(at.id)!.identity).toBe(null);
  });

  test("both the claim and the proof survive SQLite", async () => {
    const db = new SqliteStore(":memory:");
    const a = gym(db);
    const at = a.start("agent:aria", "blackbox", "7", null, 42n)!;
    await probe(a, at.id);
    expect(db.get(at.id)!.claimedId).toBe("42");
    expect(db.get(at.id)!.identity).toBe("42");
  });
});
