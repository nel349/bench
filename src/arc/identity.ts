import { createPublicClient, http, parseAbi, getAddress, type Address } from "viem";
import { chainOf, contractsOf, rpcUrl, type Network } from "./chain.ts";

/**
 * The agent's ERC-8004 identity, checked rather than searched for.
 *
 * The registry is an ERC-721: it maps an id to a wallet, and there is no reverse index from address
 * back to id. Building one would mean replaying `Transfer` logs from genesis and keeping them fresh,
 * which is an indexer — a whole service, for a question we do not actually need to ask.
 *
 * So the agent **claims** an id and we verify it. It sends `X-Agent-Id: 42`, pays, and the id is
 * accepted only if the registry says 42's wallet is the address that paid. A claim is free and a
 * payment is not, which is what makes the check meaningful: nobody can wear another agent's id
 * without holding the key that funds it.
 *
 * That is one `eth_call` against a value we already have, instead of an index we would have to run.
 */
export const REGISTRY_ABI = parseAbi([
  "function ownerOf(uint256 agentId) view returns (address)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
]);

/** What the gym needs to know about an id. A seam, so tests never reach a chain. */
export interface Registry {
  /** The address that spends for this identity, or `null` if the id is not registered. */
  walletOf(agentId: bigint): Promise<Address | null>;
  /** The account that holds the identity — the human's wallet, not the agent's. */
  ownerOf(agentId: bigint): Promise<Address | null>;
}

/** The registry on Arc, read over JSON-RPC. */
export class ArcRegistry implements Registry {
  readonly #client: ReturnType<typeof createPublicClient>;
  readonly #address: Address;

  constructor(net: Network, address?: Address) {
    const configured = address ?? contractsOf(net).erc8004?.identity;
    if (!configured) {
      throw new Error(
        `ERC-8004 is not deployed on ${net}, so an identity cannot be checked there. ` +
        "Either deploy the registries or run with identities off.",
      );
    }
    this.#address = configured as Address;
    this.#client = createPublicClient({ chain: chainOf(net), transport: http(rpcUrl(net)) });
  }

  get address(): Address { return this.#address; }

  async walletOf(agentId: bigint): Promise<Address | null> { return this.#read("getAgentWallet", agentId); }
  async ownerOf(agentId: bigint): Promise<Address | null> { return this.#read("ownerOf", agentId); }

  /**
   * An unregistered id **reverts**; it does not return zero. That is a normal answer to a normal
   * question, so it becomes `null` rather than an exception — an agent mistyping its id is not an
   * outage, and treating it as one would take the gym down one wrong header at a time.
   */
  async #read(functionName: "ownerOf" | "getAgentWallet", agentId: bigint): Promise<Address | null> {
    try {
      const out = await this.#client.readContract({
        address: this.#address, abi: REGISTRY_ABI, functionName, args: [agentId],
      });
      return out === "0x0000000000000000000000000000000000000000" ? null : (out as Address);
    } catch {
      return null;
    }
  }
}

export type IdentityCheck =
  | { readonly ok: true; readonly agentId: bigint; readonly wallet: Address }
  | { readonly ok: false; readonly because: string };

/** An id as an agent sends it: decimal digits, no sign, and small enough to be real. */
export function parseAgentId(raw: string | null | undefined): bigint | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^\d{1,78}$/.test(trimmed)) return null;
  const id = BigInt(trimmed);
  return id > 0n && id < 2n ** 256n ? id : null;
}

/**
 * Does this id belong to the address that paid?
 *
 * Compared through `getAddress`, which checksums both sides — an address that differs only in case
 * is the same address, and a string comparison would reject an agent for using lowercase.
 */
export async function checkIdentity(
  registry: Registry, agentId: bigint, payer: string,
): Promise<IdentityCheck> {
  const wallet = await registry.walletOf(agentId);
  if (!wallet) return { ok: false, because: `agent ${agentId} is not registered` };

  let a: Address, b: Address;
  try {
    a = getAddress(wallet);
    b = getAddress(payer);
  } catch {
    return { ok: false, because: "one of the addresses is not an address" };
  }

  return a === b
    ? { ok: true, agentId, wallet: a }
    : { ok: false, because: `agent ${agentId} is not paid for by that address` };
}
