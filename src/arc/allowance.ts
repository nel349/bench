import { createPublicClient, http, parseAbi, getAddress, type Address } from "viem";
import { chainOf, contractsOf, rpcUrl, type Network } from "./chain.ts";
import type { Usdc } from "../money.ts";

/**
 * What the chain says an agent may still spend.
 *
 * The gym does **not** meter allowances — the session key on the agent's own account does, and the
 * chain is what refuses a payment past the limit. This reads that limit rather than keeping one, so
 * the number shown is the same number that will do the refusing. A tally of our own could only ever
 * be a second opinion about somebody else's money, right up until the two disagreed.
 *
 * The limit lives on the **ERC-20 view** of USDC, not the native rail. That is not an implementation
 * detail: on Arc the dollar is the currency, and the mandate grants on the ERC-20 view because it is
 * the only rail that covers both a direct payment and the `approve` that funds an x402 escrow. The
 * native limit is left at zero, which refuses anything carrying value, so there is no second meter.
 * Reading the native limit here would report zero and look like a revoked allowance.
 */
export const SESSION_KEY_ABI = parseAbi([
  "struct SpendLimitInfo { bool hasLimit; uint256 limit; uint256 limitUsed; uint48 refreshInterval; uint48 lastUsedTime; }",
  "function getERC20SpendLimitInfo(address account, address sessionKey, address token) view returns (SpendLimitInfo)",
  "function getKeyTimeRange(address account, address sessionKey) view returns (uint48 validAfter, uint48 validUntil)",
]);

export interface Allowance {
  /** False when no limit is set, which for a session key means it cannot spend this token at all. */
  readonly hasLimit: boolean;
  readonly limit: Usdc;
  readonly used: Usdc;
  /** `limit - used`, floored at zero. Never negative, whatever the chain reports. */
  readonly remaining: Usdc;
  /** Seconds after which the limit refills. Zero means it never does. */
  readonly refreshInterval: number;
  /** Unix seconds. Zero means no expiry was set. */
  readonly validUntil: number;
  /** Whether it could pay right now: a limit, something left, and not expired. */
  readonly live: boolean;
}

export interface AllowanceReader {
  of(account: string, sessionKey: string): Promise<Allowance | null>;
}

/** Reads the session-key plugin on Arc. `null` when there is no allowance to read. */
export class ArcAllowances implements AllowanceReader {
  readonly #client: ReturnType<typeof createPublicClient>;
  readonly #plugin: Address;
  readonly #usdc: Address;

  constructor(net: Network) {
    const c = contractsOf(net);
    if (!c.sessionKeyPlugin) {
      throw new Error(
        `the session-key plugin is not deployed on ${net}, so an allowance cannot be read there.`,
      );
    }
    this.#plugin = c.sessionKeyPlugin as Address;
    this.#usdc = c.usdc as Address;
    this.#client = createPublicClient({ chain: chainOf(net), transport: http(rpcUrl(net)) });
  }

  get plugin(): Address { return this.#plugin; }

  async of(account: string, sessionKey: string): Promise<Allowance | null> {
    let a: Address, k: Address;
    try {
      a = getAddress(account);
      k = getAddress(sessionKey);
    } catch {
      return null;
    }

    try {
      const [info, range] = await Promise.all([
        this.#client.readContract({
          address: this.#plugin, abi: SESSION_KEY_ABI, functionName: "getERC20SpendLimitInfo",
          args: [a, k, this.#usdc],
        }),
        this.#client.readContract({
          address: this.#plugin, abi: SESSION_KEY_ABI, functionName: "getKeyTimeRange", args: [a, k],
        }),
      ]);
      return describe(info as SpendLimitInfo, Number((range as readonly [number, number])[1]));
    } catch {
      // An account with no such session key reverts. That is an answer, not an outage.
      return null;
    }
  }
}

interface SpendLimitInfo {
  hasLimit: boolean; limit: bigint; limitUsed: bigint; refreshInterval: number; lastUsedTime: number;
}

/**
 * Turns the plugin's struct into the question anyone actually asks.
 *
 * `remaining` is floored at zero. A limit that was lowered after it had been partly spent leaves
 * `used` greater than `limit`, and an unsigned subtraction there would either underflow to an
 * enormous number or, in JS, go negative and read as credit.
 */
export function describe(info: SpendLimitInfo, validUntil: number, now = Math.floor(Date.now() / 1000)): Allowance {
  const limit = info.limit;
  const used = info.limitUsed;
  const remaining = used >= limit ? 0n : limit - used;
  const expired = validUntil !== 0 && validUntil < now;

  return {
    hasLimit: info.hasLimit,
    limit, used, remaining,
    refreshInterval: Number(info.refreshInterval),
    validUntil,
    live: info.hasLimit && remaining > 0n && !expired,
  };
}
