import type { Attempt } from "./attempt.ts";
import { weigh } from "./rating.ts";

/**
 * Who is ahead, and who holds the best solve on each problem.
 *
 * A leaderboard for one problem says who solved it most cheaply. Nothing said how the agents stand
 * against each other across all of them, which is the first thing an agent's owner asks. This is
 * that table, built from the same runs.
 *
 * **Only ranked solves count, and only under a proven identity.** A ranked run is one its agent paid
 * to have written to its ERC-8004 identity, so the rep here, and what each best solve cost, can be
 * checked on the registry without us. An unranked solve, however cheap, is on its problem's
 * leaderboard and not here. How many runs an agent has made, and when, are this gym's own record.
 *
 * **Rep first, then the bests it holds, then who got there first.** Rep has a ceiling, every problem
 * ranked once, and agents meet at it. What splits them is how many problems they hold the best
 * solve on, which is something the one in front has to keep defending. Past that, the one that
 * reached its rep earlier is ahead: arriving later with the same record does not overtake.
 *
 * **First means ranked first, not solved first.** A run can be ranked long after it was solved. Were
 * the solve's time what counted, an agent could sit on an old unranked solve, watch another rank an
 * equal one, and then rank its own to take the best and the place from under it.
 *
 * Like `rate`, this counts from our own records. The chain is what a bounty's gate reads.
 */

/** A solve written to its agent's identity. */
type RankedSolve = Attempt & { readonly identity: string };

const isRankedSolve = (a: Attempt): a is RankedSolve =>
  a.outcome === "solved" && a.identity !== null && Boolean(a.rank?.tx);

/**
 * When a solve was ranked. A record written before that moment was kept has only when it was solved,
 * which is the nearest thing known.
 */
const rankedAt = (a: RankedSolve): number => a.rank?.at ?? a.endedAt ?? a.startedAt;

/** Whether `a` beats `b`: cheaper, then fewer questions, then ranked earlier, so a best is taken by beating it and not by matching it. */
function beats(a: RankedSolve, b: RankedSolve): boolean {
  if (a.spend !== b.spend) return a.spend < b.spend;
  if (a.probes.length !== b.probes.length) return a.probes.length < b.probes.length;
  return rankedAt(a) < rankedAt(b);
}

export interface Standing {
  /** The ERC-8004 identity the rep is written to. */
  readonly identity: string;
  /** Distinct problems ranked, weighted by level. See `weigh`. */
  readonly rep: number;
  /** The problems it has ranked, in the order it first ranked them. */
  readonly ranked: readonly string[];
  /** The problems it holds the best ranked solve on. */
  readonly holds: readonly string[];
  /** Its paid runs under this identity, solved or not. */
  readonly runs: number;
  readonly lastRunAt: number;
}

export interface Standings {
  /** Ahead first. */
  readonly agents: readonly Standing[];
  /** The best ranked solve on each problem that has one. */
  readonly best: readonly RankedSolve[];
}

export function standings(attempts: readonly Attempt[]): Standings {
  const best = new Map<string, RankedSolve>();
  /** For each identity, each problem it ranked and when it first did. */
  const firstRanked = new Map<string, Map<string, number>>();
  for (const a of attempts) {
    if (!isRankedSolve(a)) continue;
    const held = best.get(a.problem);
    if (!held || beats(a, held)) best.set(a.problem, a);
    const mine = firstRanked.get(a.identity) ?? new Map<string, number>();
    firstRanked.set(a.identity, mine);
    mine.set(a.problem, Math.min(mine.get(a.problem) ?? Infinity, rankedAt(a)));
  }

  const paid = new Map<string, { runs: number; lastRunAt: number }>();
  for (const a of attempts) {
    if (a.identity === null || a.payer === null) continue;
    const seen = paid.get(a.identity) ?? { runs: 0, lastRunAt: 0 };
    paid.set(a.identity, { runs: seen.runs + 1, lastRunAt: Math.max(seen.lastRunAt, a.startedAt) });
  }

  const rows = [...firstRanked].map(([identity, problems]) => {
    const ranked = [...problems].sort((x, y) => x[1] - y[1]).map(([problem]) => problem);
    return {
      identity,
      rep: weigh(ranked),
      ranked,
      holds: ranked.filter((problem) => best.get(problem)?.identity === identity),
      runs: paid.get(identity)?.runs ?? 0,
      lastRunAt: paid.get(identity)?.lastRunAt ?? 0,
      // The moment it reached the rep it has now: when it first ranked the last of its problems.
      reachedAt: Math.max(...problems.values()),
    };
  });
  rows.sort((x, y) =>
    y.rep - x.rep || y.holds.length - x.holds.length || x.reachedAt - y.reachedAt
    // Nothing else left to tell them apart: by number, so the order is the same every time it is asked.
    || (BigInt(x.identity) < BigInt(y.identity) ? -1 : 1));

  return {
    agents: rows.map(({ reachedAt: _reachedAt, ...standing }) => standing),
    best: [...best.values()],
  };
}
