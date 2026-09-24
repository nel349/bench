import { register, GENERATOR, type Problem } from "./problem.ts";
import { stream, type Seed } from "./seed.ts";

/**
 * Bisect: a change broke the build somewhere in 4,096 commits. Find the first bad one.
 *
 * The oldest commit is good and the newest is bad, and every commit from the first bad one onwards
 * is bad. Testing a commit costs. That much is binary search, and twelve tests always find it.
 *
 * What makes it the real job rather than the textbook one is that **some commits do not build**.
 * They come in short runs, as they do in a real history when a dependency is broken for a day, and
 * testing one costs the same as testing any other and says only that it could not be tested. An
 * agent that bisects blindly pays for them; one that steps around them does not. The commit just
 * before the first bad one, and the first bad one itself, always build, so the answer can always be
 * decided.
 */

export const COMMITS = 4096;
/** The oldest commit, known good, and the newest, known bad. Neither needs testing. */
export const KNOWN_GOOD = 0;
export const KNOWN_BAD = COMMITS - 1;
/** How many runs of broken commits a history has, and how long one can be. */
const BROKEN_RUNS = 6;
const LONGEST_RUN = 24;

export type Verdict = "good" | "bad" | "untestable";

export interface History {
  /** The first bad commit. Everything before it is good and everything from it on is bad. */
  readonly firstBad: number;
  /** Commits that cannot be built, and so cannot be tested. */
  readonly broken: ReadonlySet<number>;
}

export function historyFrom(seed: Seed): History {
  const next = stream(seed, "bisect/history");
  const firstBad = 1 + Math.floor(next() * (COMMITS - 1));
  const broken = new Set<number>();
  for (let run = 0; run < BROKEN_RUNS; run++) {
    const start = Math.floor(next() * COMMITS);
    const length = 1 + Math.floor(next() * LONGEST_RUN);
    for (let c = start; c < start + length && c < KNOWN_BAD; c++) {
      if (c === KNOWN_GOOD || c === firstBad - 1 || c === firstBad) continue;
      broken.add(c);
    }
  }
  return { firstBad, broken };
}

export function test(h: History, commit: number): Verdict {
  if (h.broken.has(commit)) return "untestable";
  return commit < h.firstBad ? "good" : "bad";
}

const isCommit = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n < COMMITS;

export const bisect: Problem = register({
  id: "bisect",
  title: "Bisect",
  category: "search with missing evidence",
  level: "easy",
  // Twelve tests always suffice when every commit builds. The broken ones cost extra, by an amount
  // that depends on where they fall, so no single number is proven for this problem as played.
  par: null,
  statement:
    `A change broke the build somewhere in ${COMMITS} commits, numbered from 0. Commit 0 is good ` +
    `and commit ${KNOWN_BAD} is bad, and once a commit is bad every later one is too. Test any ` +
    "commit and learn whether it is good or bad; each test costs. A few short runs of commits do " +
    "not build, and testing one costs the same and tells you only that it could not be tested. " +
    "Name the first bad commit. If every commit built, twelve tests would always be enough.",
  harness: (seed) => {
    const h = historyFrom(seed);
    return {
      probe: `{ "test": 0-${KNOWN_BAD} }`,
      answer: "the number of the first bad commit",
      commits: COMMITS, knownGood: KNOWN_GOOD, knownBad: KNOWN_BAD,
      brokenRuns: BROKEN_RUNS, longestBrokenRun: LONGEST_RUN,
      note:
        "A history is a function of its seed, in src/problems/bisect.ts. Rebuild it and replay " +
        "every test a run bought.",
      generator: GENERATOR,
      example: { seed, firstBad: h.firstBad, broken: [...h.broken].sort((a, b) => a - b) },
    };
  },
  initialState: () => null,
  probe(seed, question, state) {
    if (typeof question !== "object" || question === null) return null;
    const commit = (question as { test?: unknown }).test;
    if (!isCommit(commit)) return null;
    return { answer: { commit, result: test(historyFrom(seed), commit) }, state };
  },
  check(seed, answer) {
    return isCommit(answer) && answer === historyFrom(seed).firstBad;
  },
});
