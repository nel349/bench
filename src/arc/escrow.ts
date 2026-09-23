import { createPublicClient, http, parseAbi, getAddress, type Address } from "viem";
import { chainOf, contractsOf, rpcUrl, type Network } from "./chain.ts";
import type { Usdc } from "../money.ts";

/**
 * What the chain says about a bounty's money.
 *
 * A listing used to name its escrow with a string we stored unquestioned, so a bounty of any size
 * could be posted against an escrow that did not exist and would show on the page as open. Agents
 * pay to attempt what they see.
 *
 * The fix turned out to remove a problem rather than add one. The contract records who funded each
 * bounty, so **the poster is read from the chain and not from the request** — which means no
 * posting fee and no signature ceremony to prove identity, and a listing that points at somebody
 * else's escrow simply shows that somebody else as its poster.
 */
export const ESCROW_READ_ABI = parseAbi([
  "struct Bounty { address poster; uint64 deadline; bool settled; uint256 amount; }",
  "function get(uint256 id) view returns (Bounty)",
]);

export interface Backing {
  readonly escrowId: string;
  /** Who funded it, according to the contract. Authoritative. */
  readonly poster: Address;
  /** What it actually holds. */
  readonly amount: Usdc;
  /** When the poster may reclaim, in milliseconds to match everything else here. */
  readonly deadline: number;
  readonly settled: boolean;
}

export type Backed =
  | { readonly ok: true; readonly backing: Backing }
  | { readonly ok: false; readonly because: string }
  /** The chain could not be asked. Not the poster's fault, and not a refusal. */
  | { readonly ok: false; readonly unavailable: true; readonly because: string };

export interface EscrowReader {
  read(escrowId: string): Promise<Backed>;
}

export class ArcEscrow implements EscrowReader {
  readonly #client: ReturnType<typeof createPublicClient>;
  readonly #address: Address;

  constructor(net: Network, address?: Address) {
    const at = address ?? contractsOf(net).bountyEscrow;
    if (!at) throw new Error(`no BountyEscrow deployed on ${net}, so nothing can be backed there`);
    this.#address = getAddress(at);
    this.#client = createPublicClient({ chain: chainOf(net), transport: http(rpcUrl(net)) });
  }

  get address(): Address { return this.#address; }

  async read(escrowId: string): Promise<Backed> {
    if (!/^\d{1,78}$/.test(escrowId.trim())) {
      return { ok: false, because: "that is not an escrow id" };
    }
    const id = BigInt(escrowId.trim());
    if (id <= 0n) return { ok: false, because: "escrow ids start at 1" };

    let raw: { poster: Address; deadline: bigint; settled: boolean; amount: bigint };
    try {
      raw = await this.#client.readContract({
        address: this.#address, abi: ESCROW_READ_ABI, functionName: "get", args: [id],
      }) as typeof raw;
    } catch (cause) {
      /**
       * An unknown id **reverts**, and so does an unreachable node. They mean opposite things: one
       * is a poster naming a bounty that does not exist, the other is us being unable to check. A
       * revert carries a reason; a transport failure does not.
       */
      const message = cause instanceof Error ? cause.message : String(cause);
      if (/NoSuchBounty|reverted|execution reverted/i.test(message)) {
        return { ok: false, because: `there is no escrow ${escrowId}` };
      }
      return { ok: false, unavailable: true, because: "the chain could not be reached" };
    }

    if (raw.poster === "0x0000000000000000000000000000000000000000") {
      return { ok: false, because: `there is no escrow ${escrowId}` };
    }
    return {
      ok: true,
      backing: {
        escrowId: escrowId.trim(),
        poster: getAddress(raw.poster),
        amount: raw.amount,
        deadline: Number(raw.deadline) * 1000,
        settled: raw.settled,
      },
    };
  }
}
