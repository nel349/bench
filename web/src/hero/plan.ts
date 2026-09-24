import {
  boardFrom, ports, trace,
  type Board, type Cell, type Port, type Trace,
} from "../../../src/problems/blackbox.ts";
import { stream } from "../../../src/problems/seed.ts";

/**
 * One board, played start to finish, decided before any of it is drawn.
 *
 * The animation on the front page is a miniature of the whole product: an agent pays for rays,
 * learns where the atoms are from what comes back, and either finds them all or runs out of money.
 * Planning the run as data first — and only then playing it back with timing — is what makes it
 * testable, and what guarantees the picture never shows something the game would not do.
 *
 * Seeded throughout. The same seed plays the same run, rays and refusal included.
 */

export interface PlannedRay {
  readonly port: Port;
  readonly trace: Trace;
  /**
   * The ray the money ran out on. It is still drawn — cut short, in red — because the refusal is
   * the product's whole argument and hiding it would make the board look easier than it is.
   */
  readonly refused: boolean;
  /** How far along its path a refused ray gets before it is stopped, from 0 to 1. */
  readonly stopsAt: number;
}

export interface BoardPlan {
  readonly seed: number;
  readonly board: Board;
  readonly rays: readonly PlannedRay[];
  readonly solved: boolean;
  /** In micro-USDC. Money is an integer here, as it is everywhere else in this codebase. */
  readonly spent: number;
}

/** How many rays a board can afford. Tight enough that some boards are refused, so both endings show. */
export const RAYS_PER_BOARD = 9;

/**
 * How strongly a ray that will find a new atom is preferred.
 *
 * Pure random selection on an 8×8 board rarely finds four atoms in nine rays, so every board would
 * end refused. Weighting towards informative rays makes the agent look like it is reasoning — which
 * is the behaviour the leaderboard rewards — while leaving enough misses that it is not uncanny.
 */
const INFORMATIVE_WEIGHT = 4;

const key = (c: Cell) => `${c.x},${c.y}`;

export function planBoard(seed: number, price: number): BoardPlan {
  // Board numbers are practice seeds, so board 42 here is `?seed=42` at the harness.
  const board = boardFrom(String(seed));
  const next = stream(String(seed), "hero/rays");
  const unused = ports(board.size);
  const found = new Set<string>();
  const rays: PlannedRay[] = [];

  while (rays.length < RAYS_PER_BOARD && found.size < board.atoms.length && unused.length > 0) {
    const traced = unused.map((port) => ({ port, trace: trace(board, port) }));
    const weights = traced.map(({ trace: t }) => {
      if (t.result.kind !== "hit") return 1;
      const atom = t.path[t.path.length - 1]!;
      return found.has(key(atom)) ? 1 : INFORMATIVE_WEIGHT;
    });

    const total = weights.reduce((a, b) => a + b, 0);
    let roll = next() * total;
    let pick = 0;
    for (; pick < weights.length - 1; pick++) {
      roll -= weights[pick]!;
      if (roll < 0) break;
    }

    const chosen = traced[pick]!;
    unused.splice(unused.indexOf(chosen.port), 1);

    if (chosen.trace.result.kind === "hit") {
      found.add(key(chosen.trace.path[chosen.trace.path.length - 1]!));
    }
    rays.push({ port: chosen.port, trace: chosen.trace, refused: false, stopsAt: 1 });
  }

  const solved = found.size === board.atoms.length;

  /**
   * A board that did not solve ends on a refusal: one more ray is fired and the money is not there.
   * It is cut off part-way, which is the one thing on the page an ordinary benchmark cannot show.
   */
  if (!solved && unused.length > 0) {
    const port = unused[Math.floor(next() * unused.length)]!;
    rays.push({ port, trace: trace(board, port), refused: true, stopsAt: 0.35 + next() * 0.3 });
  }

  const paid = rays.filter((r) => !r.refused).length;
  return { seed, board, rays, solved, spent: paid * price };
}

/** The atoms a plan has found by the time `count` rays have landed. */
export function foundAfter(plan: BoardPlan, count: number): readonly Cell[] {
  const seen = new Map<string, Cell>();
  for (const ray of plan.rays.slice(0, count)) {
    if (ray.refused || ray.trace.result.kind !== "hit") continue;
    const atom = ray.trace.path[ray.trace.path.length - 1]!;
    seen.set(key(atom), atom);
  }
  return [...seen.values()];
}
