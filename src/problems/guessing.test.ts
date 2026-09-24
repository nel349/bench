import { expect, test, describe } from "bun:test";
import { boardFrom } from "./blackbox.ts";
import { KNOWN_BAD, KNOWN_GOOD } from "./bisect.ts";
import { CODES } from "./codebreaker.ts";
import { ORDERS } from "./ranking.ts";
import { NUMBERS } from "./liar.ts";
import { mazeFrom, shortestRoute } from "./toll.ts";
import { ruleFor, ruleNames, solve } from "./zendo.ts";
import "./zendo.ts";
import { problemOf } from "./problem.ts";
import "./blackbox-problem.ts";
import "./toll.ts";
import "./bisect.ts";
import "./codebreaker.ts";
import "./ranking.ts";
import "./liar.ts";

/**
 * A lucky guess must cost at least fifty times an honest solve.
 *
 * The first graded submission is free, and a run needs one paid probe to bind its payer before it
 * counts for anyone. So a guess costs about one probe, and wins one time in however many answers
 * there are. If that is cheap next to solving the problem properly, the leaderboard fills with
 * lucky guesses priced below the best honest play. `plan/PLAN_20.md` in the plans repository.
 *
 * Zendo failed this for as long as it published twenty triples; it now asks for the rule's name, and
 * is held to the same bar below, with its honest cost measured rather than assumed. `FINDINGS.md` 27.
 */
const RATIO = 50;

const choose = (n: number, k: number): number => {
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
};

/** Equally likely answers, and the probes an honest solve needs: par where proven, else an upper bound. */
const board = boardFrom("any");
const CASES: readonly { readonly id: string; readonly answers: number; readonly honest: number }[] = [
  // Every port fired once is an upper bound on an honest Black Box solve.
  { id: "blackbox", answers: choose(board.size * board.size, board.atoms.length), honest: 4 * board.size },
  // Twelve tests with nothing broken in the way; broken builds only make honest play dearer.
  { id: "bisect", answers: KNOWN_BAD - KNOWN_GOOD, honest: 12 },
  { id: "codebreaker", answers: CODES, honest: problemOf("codebreaker")!.par! },
  { id: "ranking", answers: ORDERS, honest: problemOf("ranking")!.par! },
  { id: "liar", answers: NUMBERS, honest: problemOf("liar")!.par! },
];

describe("a lucky guess costs at least fifty honest solves", () => {
  for (const c of CASES) {
    test(`${c.id}: ${c.answers} answers against ${c.honest} honest probes`, () => {
      expect(problemOf(c.id)).toBeDefined();
      expect(c.answers).toBeGreaterThanOrEqual(RATIO * c.honest);
    });
  }

  /**
   * Zendo's answer is one of its rules by name, each distinct, and a guess is one of them at random.
   * Its honest cost has no proven par, so the reference solver plays it and the average is used.
   */
  test("zendo: a guess costs at least fifty honest solves, honest play measured", async () => {
    const SEEDS = 6;
    let asked = 0;
    for (let s = 0; s < SEEDS; s++) {
      const rule = ruleFor(`guess-${s}`);
      asked += (await solve(async (t) => rule.holds(t))).asked;
    }
    expect(ruleNames().length).toBeGreaterThanOrEqual(RATIO * (asked / SEEDS));
  }, 60_000);

  /**
   * Toll's answer is a route, and a route can solve more than one maze, so counting answers says
   * little. The obvious guess is the commonest shortest route, and it must solve no
   * more than one maze in fifty, since the honest solve is a single probe for the map.
   */
  test("toll: the commonest route solves fewer than one maze in fifty", () => {
    const SAMPLES = 2000;
    const counts = new Map<string, number>();
    for (let i = 0; i < SAMPLES; i++) {
      const route = shortestRoute(mazeFrom(`toll-${i}`)).join("");
      counts.set(route, (counts.get(route) ?? 0) + 1);
    }
    const commonest = Math.max(...counts.values());
    expect(commonest / SAMPLES).toBeLessThan(1 / (RATIO * problemOf("toll")!.par!));
  });
});
