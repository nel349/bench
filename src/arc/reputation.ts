import { createPublicClient, createWalletClient, getAddress, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainOf, contractsOf, rpcUrl, type Network } from "./chain.ts";
import { describeFailure } from "./arbiter.ts";
import type { Entry, Reputation } from "../reputation.ts";

/**
 * ERC-8004 reputation, on Arc: where a ranked run becomes a record nobody has to take our word for.
 *
 * Read off the deployment, as the identity registry was. The registry on Arc testnet reports
 * version 2.0.0 and is an EIP-1967 proxy; `scripts/verify-abi.ts` looks for each selector below in
 * the bytecode behind it. Two properties of this version are what the design rests on:
 *
 * - **It refuses feedback from an identity's own owner or operators.** So an entry from the gym is
 *   one the agent could not have written about itself.
 * - **Every read names whose entries it trusts.** `getSummary` reverts on an empty list, and
 *   `readAllFeedback` filters by it. A reader asks for the scribe's entries and gets only those, so
 *   anyone else writing feedback about an agent cannot move its Bench rating.
 */
export const REPUTATION_ABI = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
  "function readAllFeedback(uint256 agentId, address[] clientAddresses, string tag1, string tag2, bool includeRevoked) view returns (address[] clients, uint64[] feedbackIndexes, int128[] values, uint8[] valueDecimals, string[] tag1s, string[] tag2s, bool[] revokedStatuses)",
]);

/** The first tag names the problem, so a reader can ask for one problem or, with an empty tag, all. */
export const PROBLEM_TAG_PREFIX = "bench:";
/**
 * The second tag names the unit, because the value is a cost and a lower cost is better. A number on
 * chain with no unit beside it is a number somebody will read the wrong way round.
 */
export const COST_TAG = "cost-usdc";
/** USDC's six places, so 80000 reads as $0.08, exactly as `Usdc` already counts it. */
export const COST_DECIMALS = 6;

export const problemTag = (problem: string): string => `${PROBLEM_TAG_PREFIX}${problem}`;

export class ArcReputation implements Reputation {
  readonly #wallet: ReturnType<typeof createWalletClient>;
  readonly #public: ReturnType<typeof createPublicClient>;
  readonly #registry: Address;
  readonly scribe: Address;

  /** `privateKey` is the scribe's. Read from the environment; never logged, never returned. */
  constructor(net: Network, privateKey: Hex, registry?: Address) {
    const configured = registry ?? contractsOf(net).erc8004?.reputation;
    if (!configured) {
      throw new Error(`ERC-8004 is not deployed on ${net}, so a run cannot be ranked there`);
    }
    this.#registry = getAddress(configured);
    const account = privateKeyToAccount(privateKey);
    this.scribe = account.address;
    const chain = chainOf(net);
    const transport = http(rpcUrl(net));
    this.#wallet = createWalletClient({ account, chain, transport });
    this.#public = createPublicClient({ chain, transport });
  }

  /**
   * Writes the entry, and waits for the receipt, because a transaction the node accepted can still
   * revert, and an entry reported as written that is not on chain is the one lie this cannot tell.
   */
  async write(entry: Entry): Promise<string> {
    try {
      const { request } = await this.#public.simulateContract({
        address: this.#registry, abi: REPUTATION_ABI, functionName: "giveFeedback",
        args: [entry.agentId, entry.cost, COST_DECIMALS, problemTag(entry.problem), COST_TAG,
               entry.endpoint, entry.uri, entry.hash],
        account: this.#wallet.account!,
      });
      const tx = await this.#wallet.writeContract(request);
      const receipt = await this.#public.waitForTransactionReceipt({ hash: tx });
      if (receipt.status !== "success") throw new Error(`the feedback transaction reverted (${tx})`);
      return tx;
    } catch (cause) {
      // Logged in full, returned plain: a viem error carries the RPC URL, and a URL can carry a key.
      console.error(`[bench] ranking for agent ${entry.agentId} failed: ${describeFailure(cause)}`);
      throw new Error("the record could not be written; asking again retries it without charging");
    }
  }

  /**
   * One read: every entry the scribe has written for this identity, in the cost unit, not revoked.
   * Entries with a problem tag this gym does not recognise are the caller's to ignore.
   */
  async ranked(agentId: bigint): Promise<readonly string[]> {
    const [, , , , tag1s] = await this.#public.readContract({
      address: this.#registry, abi: REPUTATION_ABI, functionName: "readAllFeedback",
      args: [agentId, [this.scribe], "", COST_TAG, false],
    });
    const problems = tag1s
      .filter((t) => t.startsWith(PROBLEM_TAG_PREFIX))
      .map((t) => t.slice(PROBLEM_TAG_PREFIX.length));
    return [...new Set(problems)];
  }
}
