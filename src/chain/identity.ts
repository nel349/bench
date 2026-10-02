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
/**
 * Read off the deployment, not off a spec.
 *
 * The first version of this called `getAgentWallet(uint256)`, which reads like the obvious name and
 * appears in interfaces elsewhere. **It does not exist on the registry deployed to Arc testnet.**
 * Every call would have reverted, every revert would have become "not registered", and every
 * identity claim would have failed — quietly, and identically to an agent that had genuinely not
 * registered, so nothing would have looked broken.
 *
 * What is actually there is a setter, `setAgentWallet`, whose value is read back through the
 * metadata store: `getMetadata(agentId, "agentWallet")`, returning raw bytes. `scripts/verify-abi.ts`
 * is what caught it, by looking for each selector in the deployed bytecode.
 *
 * The registry is an EIP-1967 proxy, so the selectors live in the implementation rather than at the
 * address itself. That matters for anything checking bytecode, and not at all for calling it.
 */
export const AGENT_WALLET_KEY = "agentWallet";

export const REGISTRY_ABI = parseAbi([
  "function ownerOf(uint256 agentId) view returns (address)",
  "function getMetadata(uint256 agentId, string key) view returns (bytes)",
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

  /**
   * The address that spends for this identity.
   *
   * The metadata entry first, because that is what `setAgentWallet` writes and what an agent linking
   * a fresh wallet updates. `ownerOf` is the fallback: on every identity registered on Arc testnet
   * today the two agree, and an identity whose metadata was never set should still be usable by the
   * account that holds it.
   */
  async walletOf(agentId: bigint): Promise<Address | null> {
    const fromMetadata = await this.#metadata(agentId, AGENT_WALLET_KEY);
    return fromMetadata ?? this.ownerOf(agentId);
  }

  async ownerOf(agentId: bigint): Promise<Address | null> {
    try {
      const out = await this.#client.readContract({
        address: this.#address, abi: REGISTRY_ABI, functionName: "ownerOf", args: [agentId],
      });
      return out === ZERO ? null : (out as Address);
    } catch {
      return null;
    }
  }

  /** Metadata comes back as raw bytes; twenty of them are an address and anything else is not. */
  async #metadata(agentId: bigint, key: string): Promise<Address | null> {
    try {
      const raw = await this.#client.readContract({
        address: this.#address, abi: REGISTRY_ABI, functionName: "getMetadata", args: [agentId, key],
      }) as `0x${string}`;
      return toAddress(raw);
    } catch {
      return null;
    }
  }

}

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Twenty bytes, as an address.
 *
 * An unregistered id **reverts** rather than returning zero, and a key that was never set returns
 * empty bytes. Both are normal answers to a normal question, so both become `null` — an agent
 * mistyping its id is not an outage, and treating it as one would take the gym down one wrong
 * header at a time.
 */
function toAddress(raw: string | null | undefined): Address | null {
  if (!raw || raw === "0x") return null;
  const hex = raw.slice(2);
  if (hex.length !== 40) return null;
  const address = `0x${hex}` as Address;
  return address.toLowerCase() === ZERO ? null : address;
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
