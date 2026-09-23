import { createPublicClient, http, parseAbi, getAddress, type Address } from "viem";
import { chainOf, contractsOf, rpcUrl, type Network } from "./chain.ts";
import type { Usdc } from "../money.ts";

/**
 * What an agent holds, and whether it can actually pay.
 *
 * Two balances, and confusing them is the single most likely way for an owner to get stuck.
 * **x402 spends the Gateway deposit, not the wallet.** An agent with a full wallet and no deposit
 * is refused with `insufficient_balance` while looking rich — which happened to us, and we wrote
 * the thing.
 *
 * So `ready` is about the deposit alone, and the wallet balance is shown only because an owner who
 * sent money to the right address and the wrong balance needs to see where it went.
 */
export const FUNDS_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function availableBalance(address token, address depositor) view returns (uint256)",
]);

export interface Funds {
  readonly agent: Address;
  /** USDC held by the key itself. Cannot be spent on probes; pays gas, and nothing here needs gas. */
  readonly wallet: Usdc;
  /** The Gateway deposit. This is what buys answers. */
  readonly deposit: Usdc;
  /** Whether the deposit covers at least one probe. */
  readonly ready: boolean;
  /** How many probes the deposit is worth, floored. */
  readonly probes: number;
}

export interface FundsReader {
  read(agent: string): Promise<Funds | null>;
}

export class ArcFunds implements FundsReader {
  readonly #client: ReturnType<typeof createPublicClient>;
  readonly #usdc: Address;
  readonly #gateway: Address;
  readonly #probePrice: Usdc;

  constructor(net: Network, probePrice: Usdc) {
    const c = contractsOf(net);
    this.#usdc = getAddress(c.usdc);
    this.#gateway = getAddress(c.gatewayWallet);
    this.#probePrice = probePrice;
    this.#client = createPublicClient({ chain: chainOf(net), transport: http(rpcUrl(net)) });
  }

  async read(agent: string): Promise<Funds | null> {
    let who: Address;
    try {
      who = getAddress(agent.trim());
    } catch {
      return null;
    }

    try {
      const [wallet, deposit] = await Promise.all([
        this.#client.readContract({
          address: this.#usdc, abi: FUNDS_ABI, functionName: "balanceOf", args: [who],
        }) as Promise<bigint>,
        this.#client.readContract({
          address: this.#gateway, abi: FUNDS_ABI, functionName: "availableBalance",
          args: [this.#usdc, who],
        }).catch(() => 0n) as Promise<bigint>,
      ]);
      return {
        agent: who, wallet, deposit,
        ready: deposit >= this.#probePrice,
        probes: Number(deposit / this.#probePrice),
      };
    } catch {
      return null;
    }
  }
}
