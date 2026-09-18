import type { AgentId, Payments, Quote } from "./payments.ts";
import { PRICE, submissionPrice } from "./pricing.ts";
import { format, type Usdc } from "./money.ts";
import { MemoryStore, type Store } from "./store.ts";
import { problemOf, type Problem } from "./problems/problem.ts";

/**
 * One agent's run at one problem: what it bought, what it spent, and whether it got there.
 *
 * The rule the whole product rests on lives here — **every answer costs, and running out is an
 * outcome rather than a failure.** An attempt that ends refused is a complete, recorded run with a
 * spend and no solution, not an error the caller has to interpret.
 *
 * The instance is never handed out. It is rebuilt from the seed on every call, so there is no copy
 * of the solution sitting in a response object waiting to be leaked by a careless serialiser.
 */

export type AttemptId = string;

export interface Attempt {
  readonly id: AttemptId;
  readonly agent: AgentId;
  readonly problem: string;
  /** Rebuilds the instance. Public on purpose: a stranger checking a run needs it. */
  readonly seed: number;
  readonly startedAt: number;
  endedAt: number | null;
  outcome: "open" | "solved" | "refused" | "abandoned";
  /** Every paid question, in order, with what it answered. */
  readonly probes: { readonly question: unknown; readonly answer: unknown }[];
  submissions: number;
  spend: Usdc;
  /** A cap this problem imposes, on top of whatever the agent's allowance permits. */
  readonly budget: Usdc | null;
  /** Problems where a probe changes the situation keep it here. Most do not and leave it null. */
  state: unknown;
}

export type Refusal = { readonly refused: "allowance" | "budget"; readonly wanted: Usdc; readonly remaining: Usdc };
/** The caller has not paid yet. Sign the quote and ask again — this is the 402. */
export type PaymentRequired = { readonly needsPayment: Quote };
/** The question did not parse. Nobody pays to be told their JSON was wrong. */
export type Malformed = { readonly malformed: true };

export type Asked = { readonly answer: unknown; readonly paid: Usdc; readonly spend: Usdc };
export type Graded = { readonly solved: boolean; readonly paid: Usdc; readonly spend: Usdc; readonly submissions: number };

const isOver = (a: Attempt): boolean => a.outcome !== "open";
const budgetLeft = (a: Attempt): Usdc | null => (a.budget === null ? null : a.budget - a.spend);

export class Attempts {
  /**
   * The store hands back a *copy* when it is SQLite and the same object when it is a Map. So every
   * mutation here is followed by a `put`, without exception — code that works against one and not
   * the other is the kind of bug that only appears where the store is real.
   */
  constructor(
    private readonly payments: Payments,
    private readonly store: Store = new MemoryStore(),
  ) {}

  get(id: AttemptId): Attempt | undefined { return this.store.get(id); }
  all(): Attempt[] { return this.store.all(); }

  /** Starting is free. You pay to learn, not to arrive. */
  start(agent: AgentId, problemId: string, seed: number, budget: Usdc | null = null): Attempt | null {
    const problem = problemOf(problemId);
    if (!problem) return null;
    const attempt: Attempt = {
      id: this.store.nextId(), agent, problem: problem.id, seed,
      startedAt: Date.now(), endedAt: null, outcome: "open",
      probes: [], submissions: 0, spend: 0n, budget, state: problem.initialState(seed),
    };
    this.store.put(attempt);
    return attempt;
  }

  /**
   * Buy one answer.
   *
   * The question is parsed **before** anything is charged. A malformed probe costs nothing, because
   * charging for a rejected request turns a typo into a tax and teaches an agent to fear the API.
   */
  async ask(id: AttemptId, question: unknown, proof?: string | null): Promise<Asked | Refusal | PaymentRequired | Malformed> {
    const a = this.#open(id);
    const problem = this.#problem(a);

    const answered = problem.probe(a.seed, question, a.state);
    if (!answered) return { malformed: true };

    const refusal = await this.#spend(a, PRICE.ask, "ask", proof);
    if (refusal) { this.store.put(a); return refusal; }

    a.probes.push({ question, answer: answered.answer });
    a.state = answered.state;
    this.store.put(a);
    return { answer: answered.answer, paid: PRICE.ask, spend: a.spend };
  }

  /** Submit an answer. A wrong one costs and does not end the run — buy more and try again. */
  async submit(id: AttemptId, answer: unknown, proof?: string | null): Promise<Graded | Refusal | PaymentRequired> {
    const a = this.#open(id);
    const price = submissionPrice(this.store.priorSubmissions(a.agent, a.problem));

    const refusal = await this.#spend(a, price, "submit", proof);
    if (refusal) { this.store.put(a); return refusal; }

    this.store.noteSubmission(a.agent, a.problem);
    a.submissions += 1;
    const solved = this.#problem(a).check(a.seed, answer);
    if (solved) { a.outcome = "solved"; a.endedAt = Date.now(); }
    this.store.put(a);
    return { solved, paid: price, spend: a.spend, submissions: a.submissions };
  }

  abandon(id: AttemptId): Attempt {
    const a = this.#open(id);
    a.outcome = "abandoned";
    a.endedAt = Date.now();
    this.store.put(a);
    return a;
  }

  #problem(a: Attempt): Problem {
    const p = problemOf(a.problem);
    if (!p) throw new Error(`attempt ${a.id} names a problem that no longer exists: ${a.problem}`);
    return p;
  }

  #open(id: AttemptId): Attempt {
    const a = this.store.get(id);
    if (!a) throw new Error(`no attempt ${id}`);
    if (isOver(a)) throw new Error(`attempt ${id} is ${a.outcome}`);
    return a;
  }

  /**
   * Charge for one action, against both limits.
   *
   * The problem's budget is checked first and separately from the agent's allowance, because they
   * mean different things: a budget says *this problem must be solved cheaply*, an allowance says
   * *this agent may not spend more of your money*. Both end the attempt, and the refusal names
   * which — "refused" with no reason is the message that taught us nothing last time.
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
 * The JSON-safe shape, and the only thing that should reach a response.
 *
 * `Usdc` is a bigint and `JSON.stringify` throws on those rather than rounding them, which is a
 * kindness: it forces the boundary between exact money and the wire to be written down instead of
 * happening by accident. Money crosses as a decimal string with all six places, never as a number a
 * parser might round.
 */
export interface WireScore extends Omit<Score, "spend"> { readonly spend: string }

export function wireScore(s: Score): WireScore {
  return { ...s, spend: format(s.spend) };
}

/** What an agent may see of its own attempt: never the instance, and never a bigint. */
export interface WireAttempt {
  readonly id: AttemptId;
  readonly problem: string;
  readonly seed: number;
  readonly outcome: Attempt["outcome"];
  readonly spend: string;
  readonly budget: string | null;
  readonly probes: { readonly question: unknown; readonly answer: unknown }[];
  readonly submissions: number;
}

export function wireAttempt(a: Attempt): WireAttempt {
  return {
    id: a.id, problem: a.problem, seed: a.seed, outcome: a.outcome,
    spend: format(a.spend), budget: a.budget === null ? null : format(a.budget),
    probes: a.probes, submissions: a.submissions,
  };
}
