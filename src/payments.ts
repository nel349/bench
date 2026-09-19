import { format, type Usdc } from "./money.ts";

/**
 * Taking money from an agent, and the one answer that is not an error.
 *
 * **Running out of allowance is a result.** It is the thing this product exists to show: software
 * that wanted to spend more and was refused. Modelling it as an exception would bury the most
 * interesting event in the system inside a catch block, so it is a value the caller must handle.
 *
 * The seam exists so the whole flow runs in tests with no chain, no keys and no network. The x402
 * implementation goes behind it unchanged.
 */
export type AgentId = string;

/**
 * What a `402` tells a caller: the price, the token, the chain and who to pay.
 *
 * This is the x402 quote. It is part of the payments interface rather than the HTTP layer because
 * only the implementation knows what it wants paid and where — an in-memory allowance never asks
 * for one, and the chain-backed one always does on the first try.
 */
/**
 * What a buyer is told it may pay.
 *
 * `extra` and `maxTimeoutSeconds` are not decoration: Gateway settles against the domain named in
 * `extra`, and refuses an authorisation that might expire before a batch closes. A quote without
 * them is one a real agent cannot sign.
 */
export interface Quote {
  readonly amount: Usdc;
  /** CAIP-2, e.g. `eip155:5042002`. */
  readonly chain: string;
  /** The USDC contract the payment settles in. */
  readonly token: string;
  readonly payTo: string;
  readonly scheme: "exact";
  /** Seconds the authorisation must stay valid. Gateway wants a week. */
  readonly maxTimeoutSeconds?: number;
  /** The EIP-712 domain the payment is signed against. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

export type Charge =
  /** Taken. `payer` and `settlement` appear when the money moved on a chain rather than in a Map. */
  | { readonly ok: true; readonly paid: Usdc; readonly spentSoFar: Usdc;
      readonly payer?: string; readonly settlement?: string }
  /** Out of money. A result, not an error — and on chain this is the session key refusing. */
  | { readonly ok: false; readonly refused: "allowance"; readonly wanted: Usdc; readonly remaining: Usdc }
  /**
   * The payment itself was bad: unreadable, unfunded, expired, or for the wrong thing. The quote
   * comes back with it, because a client told only that its payment failed has to guess what to
   * send instead — and the price may have moved since it asked.
   */
  | { readonly ok: false; readonly refused: "payment"; readonly reason: string; readonly quote: Quote }
  /** No proof of payment came with the request. The caller signs the quote and asks again. */
  | { readonly ok: false; readonly needsPayment: Quote }
  /**
   * Our side could not complete it. **Not** a refusal, and it matters: telling a buyer their
   * payment was rejected sends them to check a wallet that is fine. This is a 503, not a 402.
   */
  | { readonly ok: false; readonly unavailable: string };

export interface Payments {
  /**
   * Charge, refuse, or ask to be paid. Never throws for lack of funds.
   *
   * `proof` is whatever arrived in the request's payment header. An allowance held in memory ignores
   * it; an x402 implementation verifies it, and asks for one when it is absent.
   */
  charge(agent: AgentId, amount: Usdc, reason: string, proof?: string | null): Promise<Charge>;
  spentBy(agent: AgentId): Usdc;
}

/**
 * An allowance held in memory, for tests and for running the gym with no chain attached.
 *
 * It enforces the same rule the session-key plugin enforces on Arc: spend up to the cap, and not one
 * micro past it. Keeping the semantics identical is what makes the chain-backed version a swap
 * rather than a rewrite.
 */
export class InMemoryAllowance implements Payments {
  readonly #cap = new Map<AgentId, Usdc>();
  readonly #spent = new Map<AgentId, Usdc>();
  readonly log: { agent: AgentId; amount: Usdc; reason: string; ok: boolean }[] = [];

  grant(agent: AgentId, cap: Usdc): void {
    this.#cap.set(agent, cap);
    if (!this.#spent.has(agent)) this.#spent.set(agent, 0n);
  }

  capOf(agent: AgentId): Usdc { return this.#cap.get(agent) ?? 0n; }
  spentBy(agent: AgentId): Usdc { return this.#spent.get(agent) ?? 0n; }
  remaining(agent: AgentId): Usdc { return this.capOf(agent) - this.spentBy(agent); }

  async charge(agent: AgentId, amount: Usdc, reason: string, _proof?: string | null): Promise<Charge> {
    if (amount < 0n) throw new Error(`a charge cannot be negative: ${format(amount)}`);
    const remaining = this.remaining(agent);
    if (amount > remaining) {
      this.log.push({ agent, amount, reason, ok: false });
      return { ok: false, refused: "allowance", wanted: amount, remaining };
    }
    this.#spent.set(agent, this.spentBy(agent) + amount);
    this.log.push({ agent, amount, reason, ok: true });
    return { ok: true, paid: amount, spentSoFar: this.spentBy(agent) };
  }
}
