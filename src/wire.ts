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
  readonly prices: { readonly ask: Decimal; readonly submit: Decimal; readonly rank: Decimal };
}

export interface ScoreWire {
  readonly attempt: string;
  readonly agent: string;
  readonly payer: string | null;
  readonly identity: string | null;
  readonly problem: string;
  readonly seed: number;
  readonly solved: boolean;
  readonly spend: Decimal;
  readonly probes: number;
  readonly submissions: number;
  readonly wallTimeMs: number;
  readonly endedBy: "open" | "solved" | "refused" | "abandoned";
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
