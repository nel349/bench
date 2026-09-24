import type { Check } from "./checkers/check.ts";
import { parseCheck } from "./checkers/parse.ts";
import { run as runCheck } from "./checkers/run.ts";
import type { Usdc } from "./money.ts";
import { usdc, format } from "./money.ts";
import type { AgentId } from "./payments.ts";
import { MemoryBounties, type BountyStore } from "./bounty-store.ts";
import type { Backing } from "./arc/escrow.ts";

export type BountyId = string;

/**
 * A problem somebody else is paying for.
 *
 * The gym's own problems measure an agent; a bounty is a stranger wanting work done and putting
 * money behind it. The rating an agent earned on the first is what qualifies it for the second,
 * which is the whole point of charging for the first.
 */
export interface Bounty {
  readonly id: BountyId;
  readonly poster: AgentId;
  readonly title: string;
  readonly statement: string;
  /**
   * The answer key. **Never leaves this process.** It is what the bounty is paying to have worked
   * out, so every route that returns a bounty returns it without this field, and that is enforced
   * by `wireBounty` being the only way a bounty reaches a response.
   */
  readonly checker: Check;
  readonly amount: Usdc;
  /** The id of the on-chain escrow holding the money, once one is funded. */
  readonly escrowId: string | null;
  readonly deadline: number;
  /** Distinct problems an agent must have solved here before it may attempt this. */
  readonly minRating: number;
  readonly postedAt: number;
  /** The address of whoever solved it, once someone has. The escrow pays this. */
  solvedBy: string | null;
  solvedAt: number | null;
  /**
   * The transaction that actually paid it out, once one has landed.
   *
   * Separate from `solvedBy` on purpose: winning and being paid fail differently. A win is a pure
   * decision over data we hold; a payout is a transaction that can be dropped, underpriced, or land
   * while the process is restarting. A bounty with a `solvedBy` and no `awardTx` is somebody who
   * has won and not yet been paid — which is a state worth being able to name and retry, rather
   * than one to pretend cannot happen.
   */
  awardTx: string | null;
  attempts: number;
}

/** What a bounty looks like from outside: everything except the answer. */
export interface WireBounty {
  /**
   * Money crosses as a decimal string with all six places — `format`, like every other amount here.
   *
   * It used to cross as `toString()` on the bigint, which is raw micros: `500000000` where the rest
   * of the API says `500.000000`. The page rendered "$500000000" and the tests did not notice,
   * because the fixtures were written by hand in the correct format while the code produced the
   * wrong one. A fixture that disagrees with production is a test of the fixture.
   */
  readonly id: BountyId;
  readonly poster: AgentId;
  readonly title: string;
  readonly statement: string;
  readonly amount: string;
  readonly escrowId: string | null;
  readonly deadline: number;
  readonly minRating: number;
  readonly postedAt: number;
  readonly solvedBy: string | null;
  readonly solvedAt: number | null;
  readonly awardTx: string | null;
  readonly attempts: number;
  readonly open: boolean;
  /** Won, but the money has not moved yet. The poster and the winner both want to know. */
  readonly awaitingPayout: boolean;
}

export function wireBounty(b: Bounty, now = Date.now()): WireBounty {
  return {
    id: b.id, poster: b.poster, title: b.title, statement: b.statement,
    amount: format(b.amount), escrowId: b.escrowId, deadline: b.deadline,
    minRating: b.minRating, postedAt: b.postedAt,
    solvedBy: b.solvedBy, solvedAt: b.solvedAt, awardTx: b.awardTx, attempts: b.attempts,
    open: b.solvedBy === null && now <= b.deadline,
    awaitingPayout: b.solvedBy !== null && b.awardTx === null && b.escrowId !== null,
  };
}

export type Posted =
  | { readonly ok: true; readonly bounty: Bounty }
  | { readonly ok: false; readonly problem: string; readonly at?: string };

export type Solved =
  /** Right. The escrow can be awarded to `solver`. */
  | { readonly ok: true; readonly solver: string }
  /** Wrong, with the checker's reason — which never quotes the expected answer. */
  | { readonly ok: false; readonly because: string; readonly at: string }
  /** Not allowed to attempt it. A different thing from being wrong, and a different status code. */
  | { readonly ok: false; readonly unqualified: true; readonly rating: number; readonly needs: number }
  | { readonly ok: false; readonly closed: string };

/** The shortest a bounty may run. Matches the escrow's own floor, so the two cannot disagree. */
export const MIN_DURATION_MS = 60 * 60 * 1000;

export class Bounties {
  /**
   * Every mutation is followed by a `put`, without exception — SQLite hands back a copy rebuilt
   * from columns, a Map hands back the object you put in, and code that works against one and not
   * the other is the bug that only shows up where the store is real.
   */
  constructor(private readonly store: BountyStore = new MemoryBounties()) {}

  all(): Bounty[] { return this.store.all(); }
  get(id: BountyId): Bounty | undefined { return this.store.get(id); }

  /**
   * Post one.
   *
   * The checker is parsed **here**, so a broken answer key is an error in front of the person who
   * wrote it rather than a 500 discovered while grading a stranger's submission — at which point
   * the money is committed and nobody can tell whether the answer was wrong or the checker was.
   */
  post(input: {
    poster: AgentId; title: unknown; statement: unknown; checker: unknown;
    amount: unknown; deadline: unknown; minRating?: unknown; escrowId?: unknown;
  }, now = Date.now(), backing?: Backing): Posted {
    const { title, statement } = input;
    if (typeof title !== "string" || title.trim().length === 0) return { ok: false, problem: "a bounty needs a title" };
    if (typeof statement !== "string" || statement.trim().length === 0) {
      return { ok: false, problem: "a bounty needs a statement saying what is wanted" };
    }
    if (title.length > 200) return { ok: false, problem: "the title is longer than 200 characters" };
    if (statement.length > 20_000) return { ok: false, problem: "the statement is longer than 20,000 characters" };

    /**
     * Money and time come from the chain when there is an escrow, and from the request when there
     * is not.
     *
     * Not compared — *taken*. A request that disagrees with the contract cannot be half-right, and
     * reconciling the two would be inventing a rule about whose number wins. The escrow holds what
     * it holds and expires when it expires; a listing describes it.
     */
    let amount: Usdc;
    let deadline: number;

    if (backing) {
      if (backing.settled) return { ok: false, problem: `escrow ${backing.escrowId} has already been paid out or reclaimed` };
      if (backing.amount <= 0n) return { ok: false, problem: `escrow ${backing.escrowId} holds nothing` };
      if (backing.deadline < now + MIN_DURATION_MS) {
        return { ok: false, problem: `escrow ${backing.escrowId} expires too soon for anyone to attempt it` };
      }
      amount = backing.amount;
      deadline = backing.deadline;
    } else {
      if (typeof input.amount !== "string") {
        return { ok: false, problem: "amount must be a decimal string, like \"500.00\" — not a number" };
      }
      try {
        amount = usdc(input.amount);
      } catch {
        return { ok: false, problem: `amount is not an amount: ${input.amount}` };
      }
      if (amount <= 0n) return { ok: false, problem: "a bounty of nothing is not a bounty" };

      if (typeof input.deadline !== "number" || !Number.isFinite(input.deadline)) {
        return { ok: false, problem: "deadline must be a timestamp in milliseconds" };
      }
      deadline = input.deadline;
      if (deadline < now + MIN_DURATION_MS) {
        return { ok: false, problem: "the deadline is too soon for anyone to attempt it" };
      }
    }

    const minRating = input.minRating ?? 0;
    if (!Number.isInteger(minRating) || (minRating as number) < 0) {
      return { ok: false, problem: "minRating must be a whole number: the weighted rating an agent needs, from 0" };
    }

    const parsed = parseCheck(input.checker);
    if (!parsed.ok) return { ok: false, problem: parsed.problem, at: parsed.at };

    const bounty: Bounty = {
      id: this.store.nextId(),
      // The funder, per the contract — never the header. A listing pointing at somebody else's
      // escrow therefore shows that somebody else as its poster, which is self-correcting.
      poster: backing ? backing.poster : input.poster,
      title: title.trim(), statement: statement.trim(),
      checker: parsed.check, amount, escrowId: backing ? backing.escrowId : null,
      deadline, minRating: minRating as number, postedAt: now,
      solvedBy: null, solvedAt: null, awardTx: null, attempts: 0,
    };
    this.store.put(bounty);
    return { ok: true, bounty };
  }

  /**
   * Attempt one.
   *
   * The qualification gate is checked **before** the answer is, and the distinction is not
   * cosmetic: an unqualified agent should not be able to learn whether its answer was right. If
   * grading came first, a bounty would leak its answer key to anyone willing to be told "you are
   * not qualified" a few hundred times.
   *
   * `solver` is the address that paid, not the header. A bounty pays an address.
   */
  /**
   * Whether this name could attempt the bounty at all, checked for free.
   *
   * The authoritative gate runs inside `solve`, against the address that paid, because a header is
   * not an identity. But an agent that is plainly not qualified should not have to pay to find that
   * out — and it cannot be told for free unless the name it sends is checked before the money.
   *
   * Nothing is leaked by answering this: a rating is already public at `/rating/:agent`. What it
   * saves is an unqualified agent paying a graded-submission fee to be refused.
   *
   * `rating` is supplied by the caller, read from wherever ranked runs are written: the ERC-8004
   * registry on Arc. This module decides against a number and does not know where numbers live.
   */
  eligibility(id: BountyId, who: string | null, rating: number, now = Date.now()):
    { readonly ok: true } | { readonly ok: false; readonly closed: string }
    | { readonly ok: false; readonly unqualified: true; readonly rating: number; readonly needs: number } {
    const b = this.store.get(id);
    if (!b) return { ok: false, closed: `no bounty ${id}` };
    if (b.solvedBy) return { ok: false, closed: "this bounty has already been won" };
    if (now > b.deadline) return { ok: false, closed: "this bounty has expired" };

    // Checked here as well as in `solve`, for the same reason the rating is: a poster should not
    // pay a submission fee to be told they cannot win their own bounty.
    if (who && b.poster.toLowerCase() === who.toLowerCase()) {
      return { ok: false, closed: "a bounty cannot be won by whoever posted it" };
    }

    if (b.minRating === 0 || !who) return { ok: true };
    return rating >= b.minRating ? { ok: true } : { ok: false, unqualified: true, rating, needs: b.minRating };
  }

  /** Records a payout that landed. Idempotent: the first transaction to settle it is the one kept. */
  paid(id: BountyId, tx: string): void {
    const b = this.store.get(id);
    if (!b || b.awardTx) return;
    b.awardTx = tx;
    this.store.put(b);
  }

  /** Won and unpaid, oldest first. What a retry sweeps. */
  awaitingPayout(): Bounty[] {
    return this.all()
      .filter((b) => b.solvedBy !== null && b.awardTx === null && b.escrowId !== null)
      .sort((x, y) => (x.solvedAt ?? 0) - (y.solvedAt ?? 0));
  }

  solve(
    id: BountyId, answer: unknown, solver: string | null, rating: number, now = Date.now(),
  ): Solved {
    const b = this.store.get(id);
    if (!b) return { ok: false, closed: `no bounty ${id}` };
    if (b.solvedBy) return { ok: false, closed: "this bounty has already been won" };
    if (now > b.deadline) return { ok: false, closed: "this bounty has expired" };
    if (!solver) return { ok: false, closed: "a bounty pays an address, so attempting one takes a payment" };

    /**
     * A poster may not win their own bounty.
     *
     * Otherwise the money comes straight back, minus fees, and a record of having won it is bought
     * for the price of a submission — which is the cheapest reputation on the board. `SPEC.md` has
     * always listed this; nothing compared the two until now, because until the escrow was read the
     * poster was a header and comparing headers would have proved nothing.
     */
    if (b.poster.toLowerCase() === solver.toLowerCase()) {
      return { ok: false, closed: "a bounty cannot be won by whoever posted it" };
    }

    if (rating < b.minRating) {
      return { ok: false, unqualified: true, rating, needs: b.minRating };
    }

    b.attempts++;
    const verdict = runCheck(b.checker, answer);
    if (!verdict.pass) {
      this.store.put(b); // the attempt counts even when the answer does not
      return { ok: false, because: verdict.because, at: verdict.at };
    }

    b.solvedBy = solver;
    b.solvedAt = now;
    this.store.put(b);
    return { ok: true, solver };
  }
}
