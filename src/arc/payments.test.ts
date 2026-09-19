import { expect, test, describe } from "bun:test";
import { ArcPayments } from "./payments.ts";
import { payloadFor } from "./buyer.ts";
import { b64, type Facilitator, type PaymentPayload, type PaymentRequirements } from "./facilitator.ts";
import { contractsOf } from "./chain.ts";
import { usdc } from "../money.ts";
import { Attempts, score, wireAttempt } from "../attempt.ts";
import { MemoryStore, SqliteStore } from "../store.ts";
import "../problems/blackbox-problem.ts";

const PAY_TO = "0x00000000000000000000000000000000000000Be";
const AGENT = "agent:aria";
const PAYER = "0xAbC0000000000000000000000000000000000001";

/** A well-formed payment, built the way a real buyer builds one. See `buyer.ts`. */
const TERMS = {
  scheme: "exact", network: "eip155:5042002",
  asset: "0x3600000000000000000000000000000000000000",
  amount: "20000", payTo: "0x000000000000000000000000000000000000bEEF",
  maxTimeoutSeconds: 604800,
  extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" },
} as const;

/** Nothing signs it: nothing on this side verifies a signature, the facilitator does. */
const header = (): string => b64.encode(payloadFor(
  TERMS, { url: "/attempts/a1/ask", description: "One probe", mimeType: "application/json" },
  { from: PAYER as `0x${string}`, to: TERMS.payTo as `0x${string}`, value: TERMS.amount,
    validAfter: "0", validBefore: "99999999999", nonce: `0x${"11".repeat(32)}` },
  "0xsig",
));

/**
 * The facilitator, scripted.
 *
 * Every test below is about what Bench does with an answer, so the answer is given rather than
 * fetched. This is the whole reason `Facilitator` is an interface: the suite runs with no keys and
 * no network, and still exercises the refusal paths that are hardest to reach against a real one.
 */
class Scripted implements Facilitator {
  seen: PaymentRequirements[] = [];
  constructor(
    private readonly onVerify: () => Awaited<ReturnType<Facilitator["verify"]>>,
    private readonly onSettle: () => Awaited<ReturnType<Facilitator["settle"]>> = () => ({ success: true, payer: PAYER, transaction: "0xdead" }),
  ) {}
  async verify(_p: PaymentPayload, r: PaymentRequirements) { this.seen.push(r); return this.onVerify(); }
  async settle(_p: PaymentPayload, r: PaymentRequirements) { this.seen.push(r); return this.onSettle(); }
}

const ok = () => new Scripted(() => ({ isValid: true, payer: PAYER }));
const arc = (f: Facilitator, spent = () => 0n) => new ArcPayments(f, "testnet", PAY_TO, spent);

describe("what we ask to be paid", () => {
  test("no payment header is a quote, not a refusal", async () => {
    const out = await arc(ok()).charge(AGENT, usdc("0.02"), "ask");
    expect(out.ok).toBe(false);
    if (out.ok || !("needsPayment" in out)) throw new Error("expected a quote");
    expect(out.needsPayment.amount).toBe(usdc("0.02"));
    expect(out.needsPayment.payTo).toBe(PAY_TO);
    expect(out.needsPayment.token).toBe(contractsOf("testnet").usdc);
    expect(out.needsPayment.chain).toBe("eip155:5042002");
  });

  test("the requirements name the Gateway contract that will settle it", async () => {
    const f = ok();
    await arc(f).charge(AGENT, usdc("0.05"), "submit", header());
    const r = f.seen[0]!;
    expect(r.amount).toBe(usdc("0.05").toString());
    expect(r.extra).toEqual({
      name: "GatewayWalletBatched", version: "1",
      verifyingContract: contractsOf("testnet").gatewayWallet,
    });
  });

  test("it asks for a week, because Gateway will not batch anything shorter", async () => {
    const f = ok();
    await arc(f).charge(AGENT, usdc("0.02"), "ask", header());
    expect(f.seen[0]!.maxTimeoutSeconds).toBe(7 * 24 * 60 * 60);
  });
});

describe("taking it", () => {
  test("verified and settled is paid, and names the payer and the transaction", async () => {
    const out = await arc(ok(), () => usdc("0.07")).charge(AGENT, usdc("0.02"), "ask", header());
    if (!out.ok) throw new Error("expected paid");
    expect(out.paid).toBe(usdc("0.02"));
    expect(out.payer).toBe(PAYER.toLowerCase());
    expect(out.settlement).toBe("0xdead");
    expect(out.spentSoFar).toBe(usdc("0.07"));
  });

  test("it verifies before it settles, and settles only once", async () => {
    const f = ok();
    await arc(f).charge(AGENT, usdc("0.02"), "ask", header());
    expect(f.seen).toHaveLength(2); // one verify, one settle
  });

  test("a payment that does not verify is never settled", async () => {
    let settled = false;
    const f = new Scripted(
      () => ({ isValid: false, invalidReason: "insufficient_funds" }),
      () => { settled = true; return { success: true, payer: PAYER }; },
    );
    const out = await arc(f).charge(AGENT, usdc("0.02"), "ask", header());
    expect(settled).toBe(false);
    if (out.ok || !("refused" in out) || out.refused !== "payment") throw new Error("expected a payment refusal");
    expect(out.reason).toBe("insufficient_funds");
  });
});

describe("refusing it", () => {
  test("an unreadable header is refused, and the quote comes back with the reason", async () => {
    const out = await arc(ok()).charge(AGENT, usdc("0.02"), "ask", "not base64 json!!");
    if (out.ok || !("refused" in out) || out.refused !== "payment") throw new Error("expected a payment refusal");
    expect(out.refused).toBe("payment");
    expect(out.quote.amount).toBe(usdc("0.02"));
  });

  test("valid base64 that is not an x402 payload is refused, not crashed on", async () => {
    const out = await arc(ok()).charge(AGENT, usdc("0.02"), "ask", b64.encode({ hello: "world" }));
    if (out.ok || !("refused" in out) || out.refused !== "payment") throw new Error("expected a payment refusal");
    expect(out.reason).toContain("x402 payload");
  });

  test("settlement failing after a good verify is still a refusal, and charges nothing", async () => {
    const f = new Scripted(() => ({ isValid: true, payer: PAYER }), () => ({ success: false, errorReason: "batch_full" }));
    const out = await arc(f).charge(AGENT, usdc("0.02"), "ask", header());
    if (out.ok || !("refused" in out) || out.refused !== "payment") throw new Error("expected a payment refusal");
    expect(out.reason).toBe("batch_full");
  });

  test("settling without a payer is refused: we will not credit money to nobody", async () => {
    const f = new Scripted(() => ({ isValid: true }), () => ({ success: true }));
    const out = await arc(f).charge(AGENT, usdc("0.02"), "ask", header());
    if (out.ok || !("refused" in out) || out.refused !== "payment") throw new Error("expected a payment refusal");
    expect(out.reason).toContain("payer");
  });
});

describe("when the facilitator is down", () => {
  const down = () => new Scripted(() => { throw new Error("ECONNREFUSED 10.0.0.1:443 token=sk_live_secret"); });

  test("it is unavailable, and explicitly not a refusal", async () => {
    const out = await arc(down()).charge(AGENT, usdc("0.02"), "ask", header());
    if (out.ok) throw new Error("expected a failure");
    expect("unavailable" in out).toBe(true);
    expect("refused" in out).toBe(false);
  });

  test("the thrown error is not handed to the caller, because it can carry a credential", async () => {
    const out = await arc(down()).charge(AGENT, usdc("0.02"), "ask", header());
    if (out.ok || !("unavailable" in out)) throw new Error("expected unavailable");
    expect(out.unavailable).not.toContain("sk_live");
    expect(out.unavailable).not.toContain("10.0.0.1");
  });
});

/**
 * The point of the seam. `Attempts` was written against `InMemoryAllowance` and knows nothing about
 * chains, and these run it on the real one without a line of it changing.
 */
describe("through a run", () => {
  const run = async (f: Facilitator) => {
    const a = new Attempts(arc(f), new MemoryStore());
    const at = a.start(AGENT, "blackbox", 7)!;
    return { a, at };
  };

  test("an unpaid probe is a quote and the run stays open", async () => {
    const { a, at } = await run(ok());
    const out = await a.ask(at.id, { side: "up", index: 0 });
    expect("needsPayment" in out).toBe(true);
    expect(a.get(at.id)!.outcome).toBe("open");
    expect(a.get(at.id)!.probes).toHaveLength(0);
  });

  test("a paid probe is answered and charged", async () => {
    const { a, at } = await run(ok());
    const out = await a.ask(at.id, { side: "up", index: 0 }, header());
    if (!("answer" in out)) throw new Error("expected an answer");
    expect(a.get(at.id)!.probes).toHaveLength(1);
    expect(a.get(at.id)!.spend).toBe(usdc("0.02"));
  });

  test("a refused payment does NOT end the run: the wallet is the authority, not the gym", async () => {
    const f = new Scripted(() => ({ isValid: false, invalidReason: "allowance_exceeded" }));
    const { a, at } = await run(f);
    const out = await a.ask(at.id, { side: "up", index: 0 }, header());
    if (!("badPayment" in out)) throw new Error("expected badPayment");
    expect(out.badPayment).toBe("allowance_exceeded");
    expect(a.get(at.id)!.outcome).toBe("open");
    expect(a.get(at.id)!.spend).toBe(0n);
    expect(a.get(at.id)!.probes).toHaveLength(0);
  });

  test("a facilitator outage leaves the run exactly as it was", async () => {
    const { a, at } = await run(down_());
    const out = await a.ask(at.id, { side: "up", index: 0 }, header());
    expect("unavailable" in out).toBe(true);
    expect(a.get(at.id)!.outcome).toBe("open");
    expect(a.get(at.id)!.spend).toBe(0n);
  });
  function down_() { return new Scripted(() => { throw new Error("down"); }); }
});

/**
 * Identity, once it stops being a header.
 *
 * `x-agent` is whatever the caller typed. These are about the half that money proves.
 */
describe("who the payment says you are", () => {
  const other = "0xDdD0000000000000000000000000000000000002";
  const paidBy = (who: string) =>
    new Scripted(() => ({ isValid: true, payer: who }), () => ({ success: true, payer: who }));

  test("nothing is bound before anything is paid", async () => {
    const a = new Attempts(arc(ok()), new MemoryStore());
    const at = a.start(AGENT, "blackbox", 7)!;
    expect(at.payer).toBe(null);
  });

  test("the first payment binds the run to whoever paid", async () => {
    const a = new Attempts(arc(ok()), new MemoryStore());
    const at = a.start(AGENT, "blackbox", 7)!;
    await a.ask(at.id, { side: "up", index: 0 }, header());
    expect(a.get(at.id)!.payer).toBe(PAYER.toLowerCase());
  });

  test("a later payment by someone else does not steal the run", async () => {
    const f = { inner: paidBy(PAYER) };
    const swapping: Facilitator = {
      verify: (p, r) => f.inner.verify(p, r),
      settle: (p, r) => f.inner.settle(p, r),
    };
    const a = new Attempts(arc(swapping), new MemoryStore());
    const at = a.start(AGENT, "blackbox", 7)!;
    await a.ask(at.id, { side: "up", index: 0 }, header());
    f.inner = paidBy(other); // a third party picks up the tab
    await a.ask(at.id, { side: "up", index: 1 }, header());
    expect(a.get(at.id)!.payer).toBe(PAYER.toLowerCase());
    expect(a.get(at.id)!.probes).toHaveLength(2); // and their money was still taken
  });

  test("a refused payment binds nothing", async () => {
    const f = new Scripted(() => ({ isValid: false, invalidReason: "nope" }));
    const a = new Attempts(arc(f), new MemoryStore());
    const at = a.start(AGENT, "blackbox", 7)!;
    await a.ask(at.id, { side: "up", index: 0 }, header());
    expect(a.get(at.id)!.payer).toBe(null);
  });

  test("the binding is on the wire, so an agent can see who it is bound to", async () => {
    const a = new Attempts(arc(ok()), new MemoryStore());
    const at = a.start(AGENT, "blackbox", 7)!;
    await a.ask(at.id, { side: "up", index: 0 }, header());
    expect(wireAttempt(a.get(at.id)!).payer).toBe(PAYER.toLowerCase());
  });

  test("the score carries the payer, not just the header name", async () => {
    const a = new Attempts(arc(ok()), new MemoryStore());
    const at = a.start(AGENT, "blackbox", 7)!;
    await a.ask(at.id, { side: "up", index: 0 }, header());
    const s = score(a.get(at.id)!);
    expect(s.agent).toBe(AGENT);           // what they called themselves
    expect(s.payer).toBe(PAYER.toLowerCase()); // what they proved
  });

  /**
   * The regression that the upsert used to have. `start` INSERTs with a null payer, and every later
   * write goes down the `ON CONFLICT DO UPDATE` branch — which did not name `payer`, so the binding
   * was made in memory, written nowhere, and gone on the next read. Invisible to a MemoryStore.
   */
  test("the binding survives SQLite, where it is written on an UPDATE and not an INSERT", async () => {
    const db = new SqliteStore(":memory:");
    const a = new Attempts(arc(ok()), db);
    const at = a.start(AGENT, "blackbox", 7)!;
    await a.ask(at.id, { side: "up", index: 0 }, header());
    expect(db.get(at.id)!.payer).toBe(PAYER.toLowerCase());
  });
});
