import type { AgentId, Charge, Payments, Quote } from "../payments.ts";
import type { Usdc } from "../money.ts";
import { caip2, contractsOf, type Network } from "./chain.ts";
import {
  b64, isPaymentPayload, MIN_VALIDITY_SECONDS,
  type Facilitator, type PaymentRequirements,
} from "./facilitator.ts";

/**
 * Taking money on Arc, over x402.
 *
 * The shape is the same one the in-memory allowance has, and that is the point: every test written
 * against the seam keeps passing, and the difference between a gym that charges pretend money and
 * one that charges real money is which object is constructed at startup.
 *
 * **We do not track allowances here, and must not.** The cap lives in the session-key plugin on the
 * agent's own account, and the chain is what refuses a payment past it. If this class kept its own
 * tally it would be a second opinion about somebody else's money — right up until the two disagreed,
 * at which point the wrong one would be the one the gym believed.
 *
 * So a refusal from the facilitator *is* the allowance refusal, and it arrives with the reason the
 * chain gave.
 */
export class ArcPayments implements Payments {
  constructor(
    private readonly facilitator: Facilitator,
    private readonly net: Network,
    /** Where the money goes: the gym's own address. */
    private readonly payTo: string,
    /** What has been taken so far, which only the store knows. */
    private readonly spent: (agent: AgentId) => Usdc,
  ) {}

  spentBy(agent: AgentId): Usdc { return this.spent(agent); }

  quote(amount: Usdc): Quote {
    return {
      amount, chain: caip2(this.net), token: contractsOf(this.net).usdc,
      payTo: this.payTo, scheme: "exact",
    };
  }

  requirements(amount: Usdc): PaymentRequirements {
    const c = contractsOf(this.net);
    return {
      scheme: "exact",
      network: caip2(this.net),
      asset: c.usdc,
      amount: amount.toString(),
      payTo: this.payTo,
      maxTimeoutSeconds: MIN_VALIDITY_SECONDS,
      extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: c.gatewayWallet },
    };
  }

  /**
   * Verify, then settle, both before anything is served.
   *
   * Verifying alone lets a well-formed but unfundable payment through; settling without verifying
   * spends a round trip to learn the same thing. If either refuses, nothing is charged and nothing
   * is served.
   *
   * A facilitator that cannot be reached is **not** a refusal. The buyer did nothing wrong, and
   * telling them their payment was rejected sends them to check a wallet that is fine.
   */
  async charge(_agent: AgentId, amount: Usdc, _reason: string, proof?: string | null): Promise<Charge> {
    const quote = this.quote(amount);
    if (!proof) return { ok: false, needsPayment: quote };

    let decoded: unknown;
    try {
      decoded = b64.decode(proof);
    } catch {
      return { ok: false, refused: "payment", reason: "the payment header is not readable", quote };
    }
    if (!isPaymentPayload(decoded)) {
      return { ok: false, refused: "payment", reason: "the payment header is not an x402 payload", quote };
    }

    const requirements = this.requirements(amount);
    try {
      const verified = await this.facilitator.verify(decoded, requirements);
      if (!verified.isValid) {
        return { ok: false, refused: "payment", reason: verified.invalidReason ?? "the facilitator did not say", quote };
      }
      const settled = await this.facilitator.settle(decoded, requirements);
      if (!settled.success) {
        return { ok: false, refused: "payment", reason: settled.errorReason ?? "settlement did not say why", quote };
      }
      const payer = (settled.payer ?? verified.payer ?? "").toLowerCase();
      if (payer === "") {
        return { ok: false, refused: "payment", reason: "settled without naming a payer", quote };
      }
      return {
        ok: true, paid: amount, spentSoFar: this.spent(payer), payer,
        ...(settled.transaction ? { settlement: settled.transaction } : {}),
      };
    } catch (cause) {
      // Logged, not returned: a client library's error can carry an internal host or a credential,
      // and the caller has no use for any of it.
      console.error("[bench] facilitator failed:", cause instanceof Error ? cause.message : String(cause));
      return { ok: false, unavailable: "the facilitator could not be reached" };
    }
  }
}
