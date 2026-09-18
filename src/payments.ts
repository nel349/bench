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
export interface Quote {
  readonly amount: Usdc;
  /** CAIP-2, e.g. `eip155:5042002`. */
  readonly chain: string;
  /** The USDC contract the payment settles in. */
  readonly token: string;
  readonly payTo: string;
  readonly scheme: "exact";
}

export type Charge =
  | { readonly ok: true; readonly paid: Usdc; readonly spentSoFar: Usdc }
  /** Out of money. A result, not an error. */
  | { readonly ok: false; readonly refused: "allowance"; readonly wanted: Usdc; readonly remaining: Usdc }
  /** No proof of payment came with the request. The caller signs the quote and asks again. */
  | { readonly ok: false; readonly needsPayment: Quote };

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
