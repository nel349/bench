import { boardFrom, check, fire, type Board, type Cell, type Port, type RayResult } from "./problems/blackbox.ts";
import type { AgentId, Payments, Quote } from "./payments.ts";
import { PRICE, submissionPrice } from "./pricing.ts";
import { format, type Usdc } from "./money.ts";

/**
 * One agent's run at one problem: what it bought, what it spent, and whether it got there.
 *
 * The rule the whole product rests on lives here — **every answer costs, and running out is an
 * outcome rather than a failure.** An attempt that ends refused is a complete, recorded run with a
 * spend and no solution, not an error the caller has to interpret.
 *
 * The board is never handed out. It is rebuilt from the seed on each call, so there is no copy of
 * the solution sitting in a response object waiting to be leaked by a careless serialiser.
 */

export type AttemptId = string;

export interface Attempt {
  readonly id: AttemptId;
  readonly agent: AgentId;
  readonly problem: "blackbox";
  /** Rebuilds the board. Public on purpose: a stranger checking a run needs it. */
  readonly seed: number;
  readonly startedAt: number;
  /** Set once the run is over, however it ended. */
  endedAt: number | null;
  outcome: "open" | "solved" | "refused" | "abandoned";
  /** Every paid question, in order, with what it answered. */
  readonly probes: { readonly port: Port; readonly result: RayResult }[];
  /** Graded submissions made, including wrong ones. */
  submissions: number;
  /** Total charged to the agent across this attempt. */
  spend: Usdc;
  /** A cap the problem imposes, on top of whatever the agent's allowance permits. */
  readonly budget: Usdc | null;
}

export type Refusal = { readonly refused: "allowance" | "budget"; readonly wanted: Usdc; readonly remaining: Usdc };
/** The caller has not paid yet. Sign the quote and ask again — this is the 402. */
export type PaymentRequired = { readonly needsPayment: Quote };
export type Asked = { readonly result: RayResult; readonly paid: Usdc; readonly spend: Usdc };
export type Graded = { readonly solved: boolean; readonly paid: Usdc; readonly spend: Usdc; readonly submissions: number };

const isOver = (a: Attempt): boolean => a.outcome !== "open";

/** How much of the problem's budget is left, or null when it imposes none. */
function budgetLeft(a: Attempt): Usdc | null {
  return a.budget === null ? null : a.budget - a.spend;
}

export class Attempts {
  readonly #byId = new Map<AttemptId, Attempt>();
  /** Graded submissions per agent per problem, which is what makes the first one free. */
  readonly #priorSubmissions = new Map<string, number>();
  #n = 0;

  constructor(private readonly payments: Payments) {}

  get(id: AttemptId): Attempt | undefined { return this.#byId.get(id); }
  all(): Attempt[] { return [...this.#byId.values()]; }

  /** Starting is free. You pay to learn, not to arrive. */
  start(agent: AgentId, seed: number, budget: Usdc | null = null): Attempt {
    const attempt: Attempt = {
      id: `a${++this.#n}`, agent, problem: "blackbox", seed,
      startedAt: Date.now(), endedAt: null, outcome: "open",
      probes: [], submissions: 0, spend: 0n, budget,
    };
    this.#byId.set(attempt.id, attempt);
    return attempt;
  }

  board(a: Attempt): Board { return boardFrom(a.seed); }

  /** Buy one ray. */
  async ask(id: AttemptId, port: Port, proof?: string | null): Promise<Asked | Refusal | PaymentRequired> {
    const a = this.#open(id);
    const refusal = await this.#spend(a, PRICE.ask, `ask ${port.side}:${port.index}`, proof);
    if (refusal) return refusal;
    const result = fire(this.board(a), port);
    a.probes.push({ port, result });
    return { result, paid: PRICE.ask, spend: a.spend };
  }

  /** Submit a guess. Wrong answers cost and do not end the run — you may buy more and try again. */
  async submit(id: AttemptId, guess: readonly Cell[], proof?: string | null): Promise<Graded | Refusal | PaymentRequired> {
    const a = this.#open(id);
    const key = `${a.agent}:${a.problem}`;
    const prior = this.#priorSubmissions.get(key) ?? 0;
    const price = submissionPrice(prior);

    const refusal = await this.#spend(a, price, "submit", proof);
    if (refusal) return refusal;

    this.#priorSubmissions.set(key, prior + 1);
    a.submissions += 1;
    const solved = check(this.board(a), guess);
    if (solved) { a.outcome = "solved"; a.endedAt = Date.now(); }
    return { solved, paid: price, spend: a.spend, submissions: a.submissions };
  }

  abandon(id: AttemptId): Attempt {
    const a = this.#open(id);
    a.outcome = "abandoned";
    a.endedAt = Date.now();
    return a;
  }

  #open(id: AttemptId): Attempt {
    const a = this.#byId.get(id);
    if (!a) throw new Error(`no attempt ${id}`);
    if (isOver(a)) throw new Error(`attempt ${id} is ${a.outcome}`);
    return a;
  }

  /**
   * Charge for one action, against both limits.
   *
   * The problem's budget is checked first and separately from the agent's allowance, because they
   * mean different things: a budget says *this problem must be solved cheaply*, an allowance says
   * *this agent may not spend more of your money*. Both end the attempt, and the reason is recorded,
   * because "refused" without a reason is the message that taught us nothing last time.
   */
  async #spend(a: Attempt, amount: Usdc, reason: string, proof?: string | null): Promise<Refusal | PaymentRequired | null> {
    if (amount === 0n) return null;

    const left = budgetLeft(a);
    if (left !== null && amount > left) {
      a.outcome = "refused"; a.endedAt = Date.now();
      return { refused: "budget", wanted: amount, remaining: left };
    }

    const charge = await this.payments.charge(a.agent, amount, reason, proof);
    if (!charge.ok) {
      // Asking to be paid is not a refusal: the run is still open and the caller may pay and retry.
      if ("needsPayment" in charge) return { needsPayment: charge.needsPayment };
      a.outcome = "refused"; a.endedAt = Date.now();
      return { refused: "allowance", wanted: charge.wanted, remaining: charge.remaining };
    }

    a.spend += amount;
    return null;
  }
}

/** What a finished run is worth to a board: the record, with nothing derived at read time. */
export interface Score {
  readonly attempt: AttemptId;
  readonly agent: AgentId;
  readonly problem: string;
  readonly seed: number;
  readonly solved: boolean;
  readonly spend: Usdc;
  readonly probes: number;
  readonly submissions: number;
  readonly wallTimeMs: number;
  readonly endedBy: Attempt["outcome"];
}

export function score(a: Attempt): Score {
  return {
    attempt: a.id, agent: a.agent, problem: a.problem, seed: a.seed,
    solved: a.outcome === "solved",
    spend: a.spend, probes: a.probes.length, submissions: a.submissions,
    wallTimeMs: (a.endedAt ?? Date.now()) - a.startedAt,
    endedBy: a.outcome,
  };
}

/**
 * The JSON-safe shape of a score, and the only thing that should reach a response.
 *
 * `Usdc` is a bigint, and `JSON.stringify` throws on those rather than rounding them — which is a
 * kindness. It means the boundary between exact money and the wire has to be written down instead of
 * happening by accident, and money crosses it as a decimal string with all six places, never as a
 * number a parser might round.
 *
 * A test asserts this, because the failure it prevents only appears once there is an HTTP layer and
 * by then it looks like a serialiser bug rather than a money bug.
 */
export interface WireScore {
  readonly attempt: AttemptId;
  readonly agent: AgentId;
  readonly problem: string;
  readonly seed: number;
  readonly solved: boolean;
  /** Decimal string, six places. Never a number. */
  readonly spend: string;
  readonly probes: number;
  readonly submissions: number;
  readonly wallTimeMs: number;
  readonly endedBy: Attempt["outcome"];
}

export function wireScore(s: Score): WireScore {
  return { ...s, spend: format(s.spend) };
}

/** What an agent may see of its own attempt: never the board, and never a bigint. */
export interface WireAttempt {
  readonly id: AttemptId;
  readonly problem: string;
  readonly seed: number;
  readonly outcome: Attempt["outcome"];
  readonly spend: string;
  readonly budget: string | null;
  readonly probes: { readonly port: Port; readonly result: RayResult }[];
  readonly submissions: number;
}

export function wireAttempt(a: Attempt): WireAttempt {
  return {
    id: a.id, problem: a.problem, seed: a.seed, outcome: a.outcome,
    spend: format(a.spend), budget: a.budget === null ? null : format(a.budget),
    probes: a.probes, submissions: a.submissions,
  };
}
