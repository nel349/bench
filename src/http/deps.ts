import { Attempts, type IdentityVerifier } from "../gym/attempt.ts";
import type { Payments } from "../gym/payments.ts";
import { type Network } from "../chain/chain.ts";
import { type Bounties } from "../bounties/bounties.ts";
import type { AllowanceReader } from "../chain/allowance.ts";
import type { Arbiter } from "../chain/arbiter.ts";
import type { EscrowReader } from "../chain/escrow.ts";
import type { FundsReader } from "../chain/funds.ts";
import type { Reputation } from "../gym/reputation.ts";
import type { Limits } from "./limits.ts";

/** Everything a route may use, supplied by `main.ts`, and by the tests directly. */
export interface Deps {
  readonly attempts: Attempts;
  readonly payments: Payments;
  readonly net: Network;
  /** Sends the payout when a bounty is won. Absent where no key is configured to sign one. */
  readonly arbiter?: Arbiter;
  /** Reads what the chain says about a bounty's money. Absent where no escrow is deployed. */
  readonly escrow?: EscrowReader;
  /** Reads what an agent holds, for the funding page. */
  readonly funds?: FundsReader;
  /** Reads the session-key plugin, where one is deployed. Absent on a network without it. */
  readonly allowances?: AllowanceReader;
  /**
   * Bounties, where a server runs them. Optional rather than always-on: a gym with no escrow behind
   * it should answer 404 on these rather than take a posting it cannot pay out.
   */
  readonly bounties?: Bounties;
  /**
   * Where ranked runs are written and ratings read back: ERC-8004 on Arc. Absent where there is no
   * registry, and then nothing can be ranked and no bounty can require a record, because nothing
   * here could check one.
   */
  readonly reputation?: Reputation;
  /** Whether an ERC-8004 id belongs to the address that paid. Absent where identities are off. */
  readonly verifyIdentity?: IdentityVerifier;
  /**
   * Who holds an ERC-8004 identity: the owner's wallet, or `null` for an identity nobody holds. It
   * throws when the registry could not be asked, so a failed read is never taken for an answer.
   * Absent where there is no registry.
   */
  readonly ownerOf?: (agentId: bigint) => Promise<string | null>;
  /** The same gym on the other Arc network, as an origin. Absent where none is named. */
  readonly otherGym?: string;
  /** Caps on free requests and graded submissions. Absent, nothing is capped: tests and scripts. */
  readonly limits?: Limits;
}

/** What every route reads from a request, worked out once. */
export interface RouteContext {
  readonly req: Request;
  readonly deps: Deps;
  readonly client: string;
  readonly url: URL;
  readonly path: string;
  readonly seg: readonly string[];
  readonly prices: { readonly ask: string; readonly submit: string; readonly rank: string };
}
