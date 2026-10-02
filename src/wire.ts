/**
 * The shapes that cross the wire, defined once.
 *
 * **Types only, and no runtime imports.** Both the server and the browser app import from here with
 * `import type`, so the compiler holds them to the same contract and nothing from the server —
 * `bun:sqlite`, a chain client, a private key — can ever reach a bundle.
 *
 * Before this, a status was the string `"good"` in a server template and the string `"good"` again
 * in a hand-written browser script, with nothing checking that they matched.
 */

/** Money always crosses as a decimal string with six places. Never a number, never a bigint. */
export type Decimal = string;

/** What an agent holds, and whether it can pay. */
export interface FundsWire {
  readonly agent: string;
  /** Held by the key itself. Cannot buy answers. */
  readonly wallet: Decimal;
  /** The Gateway deposit. This is what buys answers. */
  readonly deposit: Decimal;
  readonly ready: boolean;
  readonly probes: number;
}

/** How a balance reads to a person. One set of states, used by the server and the app alike. */
export type Standing = "ready" | "short" | "unknown";

export interface HealthWire {
  readonly ok: boolean;
  readonly network: string;
  readonly chain: string;
  readonly problems: number;
  readonly runs: number;
  readonly payments: "x402" | "in-memory";
  readonly bounties: "on" | "off";
  readonly escrowChecked: boolean;
  readonly payouts: "on" | "off";
}

export interface ProblemWire {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly level: "easy" | "medium" | "hard";
  /** The fewest probes that are always enough, where proven. See `Problem.par`. */
  readonly par: number | null;
  readonly prices: { readonly ask: Decimal; readonly submit: Decimal; readonly rank: Decimal };
}

/** What the server is serving, asked once when the page loads. Addresses come from here, never the bundle. */
export interface SettingsWire {
  readonly chainId: number;
  readonly usdc: string;
  readonly gateway: string;
  readonly probePrice: Decimal;
  /** The ERC-8004 reputation registry, where ranked runs are written. `null` where there is none. */
  readonly reputation: string | null;
  /** The owner's wallet, where an allowance is granted and revoked. `null` where there is none yet. */
  readonly wallet: string | null;
}

/** One problem in full: what the list says, and the statement. */
export interface ProblemDetailWire extends ProblemWire {
  readonly statement: string;
  readonly scoring: string;
}

/** An agent's rep as the bounty gate reads it: from ERC-8004, for an identity, by the scribe. */
export interface ChainRatingWire {
  readonly agent: string;
  readonly rating: number;
  readonly ranked: readonly string[];
  /** The only address whose entries count. A reader filters the registry by it. */
  readonly scribe: string;
  readonly source: "erc-8004";
}

/** What a wallet's allowance to one agent stands at, read from the plugin. */
export interface OwnerAllowanceWire {
  readonly limit: Decimal;
  readonly used: Decimal;
  readonly remaining: Decimal;
  /** Unix seconds; zero when it never ends. */
  readonly validUntil: number;
  readonly live: boolean;
}

/** One of a wallet's agents, as its owner wants to see it. */
export interface OwnerAgentWire {
  /** The agent's own key: the address that pays. */
  readonly address: string;
  /** `null` when the plugin will not say, which reads as unknown rather than as nothing. */
  readonly allowance: OwnerAllowanceWire | null;
  /** The ERC-8004 identity its runs carry, once a run has carried one. */
  readonly identity: string | null;
  /** Rep from the registry for that identity, and what it ranked. `null` without an identity. */
  readonly rep: number | null;
  readonly ranked: readonly string[];
  /** The run it is playing now, if any. */
  readonly live: ScoreWire | null;
  /** Its paid runs, newest first. */
  readonly runs: readonly FeedRowWire[];
  readonly spend: Decimal;
  /** Open gigs its rep already admits it to. */
  readonly qualifies: readonly string[];
}

/** One owner's page: a wallet and its agents. */
export interface OwnerWire {
  readonly wallet: string;
  readonly agents: readonly OwnerAgentWire[];
}

/** The runs an address paid for, and what they cost. */
export interface AgentRecordWire {
  readonly agent: string;
  readonly spend: Decimal;
  readonly attempts: number;
  readonly solved: number;
  readonly refused: number;
  readonly runs: readonly ScoreWire[];
}

export interface ScoreWire {
  readonly attempt: string;
  readonly agent: string;
  readonly payer: string | null;
  readonly identity: string | null;
  readonly problem: string;
  /** Published when the run is over, `null` while it is open. */
  readonly seed: string | null;
  /** SHA-256 of the seed, public from the start. */
  readonly fingerprint: string;
  readonly solved: boolean;
  readonly spend: Decimal;
  readonly probes: number;
  readonly submissions: number;
  readonly wallTimeMs: number;
  readonly endedBy: "open" | "solved" | "refused" | "abandoned";
  /** Written to the agent's ERC-8004 identity, which is when a solve counts as rep. */
  readonly ranked: boolean;
}

export interface FeedRowWire extends ScoreWire {
  readonly startedAt: number;
}

export interface BountyWire {
  readonly id: string;
  readonly poster: string;
  readonly title: string;
  readonly statement: string;
  readonly amount: Decimal;
  readonly escrowId: string | null;
  readonly deadline: number;
  readonly minRating: number;
  readonly postedAt: number;
  readonly solvedBy: string | null;
  readonly solvedAt: number | null;
  readonly awardTx: string | null;
  readonly attempts: number;
  readonly open: boolean;
  readonly awaitingPayout: boolean;
}
