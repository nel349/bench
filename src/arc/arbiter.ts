import { privateKeyFrom } from "./keys.ts";
import {
  createWalletClient, createPublicClient, http, parseAbi, getAddress,
  type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainOf, rpcUrl, type Network } from "./chain.ts";

/**
 * Paying a bounty out.
 *
 * `solve` decides who won; this is what moves the money. They are deliberately separate, because
 * they fail differently: deciding is a pure function over data we hold, and paying is a transaction
 * that can be dropped, underpriced, or land while the process is being restarted.
 *
 * So a win is **recorded first and paid second**, and a failed payout never un-wins a bounty. The
 * alternative — refusing the win because the transaction failed — would make an agent's prize
 * depend on the gas market at the moment it answered.
 */
export const ESCROW_ABI = parseAbi([
  "function award(uint256 id, address solver)",
  "function isOpen(uint256 id) view returns (bool)",
  "function arbiter() view returns (address)",
]);

export type Award =
  | { readonly ok: true; readonly tx: Hex }
  | { readonly ok: false; readonly because: string };

export interface Arbiter {
  award(escrowId: string, solver: string): Promise<Award>;
  /** The address that must be the escrow's arbiter for any of this to work. */
  readonly address: Address;
}

export interface ArcArbiterOptions {
  readonly escrow: Address;
  /** The key that signs the payout. Read from the environment; never logged, never returned. */
  readonly privateKey: Hex;
}

export class ArcArbiter implements Arbiter {
  readonly #wallet: ReturnType<typeof createWalletClient>;
  readonly #public: ReturnType<typeof createPublicClient>;
  readonly #escrow: Address;
  readonly address: Address;

  constructor(net: Network, opts: ArcArbiterOptions) {
    const account = privateKeyToAccount(opts.privateKey);
    this.address = account.address;
    this.#escrow = getAddress(opts.escrow);
    const chain = chainOf(net);
    const transport = http(rpcUrl(net));
    this.#wallet = createWalletClient({ account, chain, transport });
    this.#public = createPublicClient({ chain, transport });
  }

  /**
   * Sends the award, and waits for it.
   *
   * Waiting matters: a transaction that is accepted by the node and then reverts has still "been
   * sent", and reporting that as paid would leave a bounty marked settled with the money still in
   * escrow. The receipt's status is the only thing that says it actually happened.
   */
  async award(escrowId: string, solver: string): Promise<Award> {
    let id: bigint;
    let to: Address;
    try {
      id = BigInt(escrowId);
      to = getAddress(solver);
    } catch {
      return { ok: false, because: "the escrow id or the solver address is malformed" };
    }

    try {
      const { request } = await this.#public.simulateContract({
        address: this.#escrow, abi: ESCROW_ABI, functionName: "award",
        args: [id, to], account: this.#wallet.account!,
      });

      const tx = await this.#wallet.writeContract(request);
      const receipt = await this.#public.waitForTransactionReceipt({ hash: tx });

      return receipt.status === "success"
        ? { ok: true, tx }
        : { ok: false, because: `the award transaction reverted (${tx})` };
    } catch (cause) {
      /**
       * Logged, never returned: a viem error carries the RPC URL, and an RPC URL can carry a key.
       *
       * The *useful* part is `shortMessage` and `details` rather than `message`, whose first line is
       * often just "Transaction creation failed." — which says nothing and sent me looking in the
       * wrong place once already. The URL is stripped rather than the whole thing truncated.
       */
      console.error(`[bench] awarding escrow ${escrowId} failed: ${describeFailure(cause)}`);
      return { ok: false, because: "the payout could not be sent; it can be retried" };
    }
  }
}

/** Anything that looks like a URL, gone. A key can be embedded in an RPC endpoint. */
const stripUrls = (s: string): string => s.replace(/\bhttps?:\/\/\S+/gi, "<rpc>");

/**
 * The part of a viem error that says what actually went wrong.
 *
 * `message` leads with a generic line; the cause chain is where the reason lives. Walked to a
 * bounded depth so a self-referential cause cannot spin.
 */
export function describeFailure(cause: unknown, depth = 0): string {
  if (depth > 4 || cause === null || cause === undefined) return "unknown";
  if (typeof cause !== "object") return stripUrls(String(cause)).slice(0, 300);

  const e = cause as { shortMessage?: unknown; details?: unknown; message?: unknown; cause?: unknown };
  const parts = [e.shortMessage, e.details, e.message]
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.split("\n")[0]!.trim());

  const here = [...new Set(parts)].join(" — ");
  const deeper = e.cause ? describeFailure(e.cause, depth + 1) : "";
  const all = deeper && !here.includes(deeper) ? `${here} · ${deeper}` : here;
  return stripUrls(all || "unknown").slice(0, 300);
}

/** Reads the key an arbiter signs with. See `privateKeyFrom`. */
export function arbiterKey(raw: string | undefined): Hex | null {
  return privateKeyFrom("BENCH_ARBITER_KEY", raw);
}
