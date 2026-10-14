import { stream, type Seed } from "../../../../src/problems/seed.ts";
import { mazeFrom, shortestRoute, START, type Dir, type Walls } from "../../../../src/problems/toll.ts";
import { COMMITS, historyFrom, KNOWN_BAD, KNOWN_GOOD, test, type History, type Verdict } from "../../../../src/problems/bisect.ts";
import { DOMAIN, ruleFor, type Triple } from "../../../../src/problems/zendo.ts";
import { codeFrom, score, type Score } from "../../../../src/problems/codebreaker.ts";
import { better, orderFrom } from "../../../../src/problems/ranking.ts";
import { boardFrom, ports, trace, type Board, type Cell, type RayResult, type Trace } from "../../../../src/problems/blackbox-rules.ts";
import { LIE_WINDOW, NUMBERS, secretFrom } from "../../../../src/problems/liar.ts";

/**
 * The seed every exercise page draws its sample from.
 *
 * Any text is a seed, and the gym's own generators build the same instance from it that a run would.
 * A run's seed is 32 random bytes kept secret until the run ends, so no run is ever played on this
 * one: showing its answer gives nothing away.
 */
export const SAMPLE_SEED: Seed = "sample";

export interface TollSample {
  readonly maze: Walls[][];
  /** The shortest route, as the cells it passes through, start and exit included. */
  readonly path: readonly Cell[];
  readonly steps: number;
}

const STEP: Record<Dir, readonly [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

export function tollSample(seed: Seed = SAMPLE_SEED): TollSample {
  const maze = mazeFrom(seed);
  const route = shortestRoute(maze);
  const path: Cell[] = [{ ...START }];
  for (const d of route) {
    const last = path[path.length - 1]!;
    path.push({ x: last.x + STEP[d][0], y: last.y + STEP[d][1] });
  }
  return { maze, path, steps: route.length };
}

/** A stretch of commits that will not build. */
export interface Span { readonly from: number; readonly to: number }

/** One commit tested, and what the test said. */
export interface Probe { readonly commit: number; readonly verdict: Verdict }

export interface BisectSample {
  readonly commits: number;
  readonly firstBad: number;
  /** The commits that cannot be built, as runs, oldest first. */
  readonly broken: readonly Span[];
  readonly brokenCount: number;
  /** A search for the first bad commit, every test it paid for in order. */
  readonly probes: readonly Probe[];
}

/**
 * Binary search that steps around a commit that will not build: test the middle, and if it cannot
 * be tested, the nearest commit either side of it that is still inside the range. Each test is one
 * paid question, the ones that come back untestable included.
 */
function search(h: History): Probe[] {
  let good = KNOWN_GOOD, bad = KNOWN_BAD;
  const probes: Probe[] = [];
  while (bad - good > 1) {
    const mid = Math.floor((good + bad) / 2);
    let moved = false;
    for (let d = 0; !moved && (mid - d > good || mid + d < bad); d++) {
      for (const c of d === 0 ? [mid] : [mid + d, mid - d]) {
        if (moved || c <= good || c >= bad) continue;
        const verdict = test(h, c);
        probes.push({ commit: c, verdict });
        if (verdict === "good") { good = c; moved = true; }
        else if (verdict === "bad") { bad = c; moved = true; }
      }
    }
  }
  return probes;
}

export function bisectSample(seed: Seed = SAMPLE_SEED): BisectSample {
  const h = historyFrom(seed);
  const sorted = [...h.broken].sort((a, b) => a - b);
  const broken: Span[] = [];
  for (const c of sorted) {
    const last = broken[broken.length - 1];
    if (last && last.to === c - 1) broken[broken.length - 1] = { from: last.from, to: c };
    else broken.push({ from: c, to: c });
  }
  return { commits: COMMITS, firstBad: h.firstBad, broken, brokenCount: h.broken.size, probes: search(h) };
}

export interface ZendoSample {
  readonly rule: string;
  /** Triples an agent might ask about, half that the rule holds for and half that it does not. */
  readonly asked: readonly { readonly triple: Triple; readonly holds: boolean }[];
}

/** How many triples the sample shows of each answer. */
const ZENDO_EACH = 3;
/** Enough tries to find both answers for any rule in the list, which are never rarer than one in twenty. */
const ZENDO_TRIES = 2000;

export function zendoSample(seed: Seed = SAMPLE_SEED): ZendoSample {
  const rule = ruleFor(seed);
  // A stream of its own, apart from the rule's: these are examples, not part of the instance.
  const next = stream(seed, "sample/zendo");
  const yes: Triple[] = [];
  const no: Triple[] = [];
  const pick = () => Math.floor(next() * DOMAIN);
  for (let i = 0; i < ZENDO_TRIES && (yes.length < ZENDO_EACH || no.length < ZENDO_EACH); i++) {
    const t: Triple = [pick(), pick(), pick()];
    const into = rule.holds(t) ? yes : no;
    if (into.length < ZENDO_EACH) into.push(t);
  }
  // Interleaved, a yes then a no, so the rows read as questions an agent might ask in turn.
  const asked = yes.flatMap((triple, i) => {
    const other = no[i];
    return other ? [{ triple, holds: true }, { triple: other, holds: false }] : [{ triple, holds: true }];
  });
  return { rule: rule.name, asked };
}

export interface CodebreakerSample {
  readonly code: string;
  readonly guesses: readonly { readonly guess: string; readonly score: Score }[];
}

/** The opening a person would play: each colour tried twice, two at a time. */
const OPENING = ["AABB", "CCDD", "EEFF"] as const;

export function codebreakerSample(seed: Seed = SAMPLE_SEED): CodebreakerSample {
  const code = codeFrom(seed);
  return { code, guesses: OPENING.map((guess) => ({ guess, score: score(code, guess) })) };
}

export interface RankingSample {
  /** The hidden order, best first. */
  readonly order: string;
  /** One question and the gym's answer to it. */
  readonly asked: { readonly a: string; readonly b: string; readonly better: string };
}

export function rankingSample(seed: Seed = SAMPLE_SEED): RankingSample {
  const order = orderFrom(seed);
  // The first and last letters of the alphabet, so the question does not depend on the answer.
  const a = "A", b = "H";
  return { order, asked: { a, b, better: better(order, a, b) } };
}

export interface BlackBoxSample {
  readonly board: Board;
  /** One ray of each kind the board allows, in the order hit, turned back, deflected out. */
  readonly rays: readonly Trace[];
}

const RAY_KINDS: readonly RayResult["kind"][] = ["hit", "reflect", "detour"];

export function blackBoxSample(seed: Seed = SAMPLE_SEED): BlackBoxSample {
  const board = boardFrom(seed);
  const all = ports(board.size).map((p) => trace(board, p));
  // A ray that leaves without meeting an atom also counts as leaving elsewhere; the one shown turns, so it is seen to.
  const turns = (t: Trace) => new Set(t.path.map((c) => c.x)).size > 1 && new Set(t.path.map((c) => c.y)).size > 1;
  const rays = RAY_KINDS.flatMap((kind) => {
    const ofKind = all.filter((t) => t.result.kind === kind);
    return (kind === "detour" ? ofKind.find(turns) : undefined) ?? ofKind[0] ?? [];
  });
  return { board, rays };
}

export interface LiarSample {
  readonly numbers: number;
  readonly number: number;
  /** Which answer is the lie, counting from one, as a person would. */
  readonly lie: number;
  readonly window: number;
}

export function liarSample(seed: Seed = SAMPLE_SEED): LiarSample {
  const s = secretFrom(seed);
  return { numbers: NUMBERS, number: s.number, lie: s.lieAt + 1, window: LIE_WINDOW };
}
