import { stream, type Seed } from "./seed.ts";
import { GENERATOR, register, type Problem } from "./problem.ts";

/**
 * Toll: a maze you cannot see, and a route you have to pay to learn.
 *
 * This is the problem the earlier project was built around, reduced to one exercise. There it was
 * the whole product and had to carry a game it did not have; here it is a machine in the gym, which
 * is what it was always better suited to being.
 *
 * You buy what you can see, then submit a route. Looking at one cell is cheap; the map is one probe
 * that reveals everything and costs the same as any other probe — so the decision is not *whether*
 * information is worth money, it is how many cells you are willing to buy before guessing at the
 * shape of the rest. Buy the map immediately and you have spent one probe; feel your way and you may
 * spend thirty.
 *
 * No state: looking at a cell does not move you anywhere. The route is submitted whole and replayed
 * by the checker, which means a run is verifiable by a stranger from the seed and the answer alone.
 */

export type Dir = "N" | "E" | "S" | "W";
export interface Walls { readonly N: boolean; readonly E: boolean; readonly S: boolean; readonly W: boolean }

const SIZE = 8;
const STEP: Record<Dir, readonly [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const OPPOSITE: Record<Dir, Dir> = { N: "S", E: "W", S: "N", W: "E" };

/**
 * A perfect maze by recursive backtracking: every cell reachable, exactly one route between any two.
 *
 * Written out rather than imported for the same reason the board generator is — a stranger checking
 * a run should not have to match a dependency's version to rebuild the maze.
 */
export function mazeFrom(seed: Seed): Walls[][] {
  const next = stream(seed, "toll/maze");
  const walls: { N: boolean; E: boolean; S: boolean; W: boolean }[][] =
    Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => ({ N: true, E: true, S: true, W: true })));
  const seen = Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false));
  const stack: [number, number][] = [[0, 0]];
  seen[0]![0] = true;

  while (stack.length > 0) {
    const [x, y] = stack[stack.length - 1]!;
    const open = (["N", "E", "S", "W"] as Dir[]).filter((d) => {
      const [dx, dy] = STEP[d];
      const nx = x + dx, ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < SIZE && ny < SIZE && !seen[ny]![nx];
    });
    if (open.length === 0) { stack.pop(); continue; }
    const d = open[Math.floor(next() * open.length)]!;
    const [dx, dy] = STEP[d];
    const nx = x + dx, ny = y + dy;
    walls[y]![x]![d] = false;
    walls[ny]![nx]![OPPOSITE[d]] = false;
    seen[ny]![nx] = true;
    stack.push([nx, ny]);
  }
  return walls as Walls[][];
}

export const START = { x: 0, y: 0 } as const;
export const EXIT = { x: SIZE - 1, y: SIZE - 1 } as const;

type Question =
  | { readonly look: { readonly x: number; readonly y: number } }
  | { readonly map: true };

function parse(q: unknown): Question | null {
  if (typeof q !== "object" || q === null) return null;
  const o = q as Record<string, unknown>;
  if (o["map"] === true) return { map: true };
  const look = o["look"];
  if (typeof look === "object" && look !== null) {
    const { x, y } = look as { x?: unknown; y?: unknown };
    if (typeof x === "number" && typeof y === "number" &&
        Number.isInteger(x) && Number.isInteger(y) &&
        x >= 0 && y >= 0 && x < SIZE && y < SIZE) return { look: { x, y } };
  }
  return null;
}

/** Replay a route from the start. Every step must pass through an opening, and it must end at the exit. */
export function walk(maze: Walls[][], route: readonly Dir[]): boolean {
  if (route.length === 0 || route.length > SIZE * SIZE * 4) return false;
  let { x, y } = START;
  for (const d of route) {
    if (maze[y]![x]![d]) return false;             // a wall is a wall
    const [dx, dy] = STEP[d];
    x += dx; y += dy;
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return false;
  }
  return x === EXIT.x && y === EXIT.y;
}

/**
 * The shortest route through a maze, breadth-first through the openings.
 *
 * The reference solution, in the open like the rest: it is only as useful as the map, and the map
 * is paid for. Tests use it to know an answer without trusting the checker, since `walk` is written
 * separately and the two have to agree.
 */
export function shortestRoute(maze: Walls[][]): Dir[] {
  const step: Record<Dir, readonly [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
  const seen = new Set<string>([`${START.x},${START.y}`]);
  const queue: { x: number; y: number; path: Dir[] }[] = [{ ...START, path: [] }];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.x === EXIT.x && cur.y === EXIT.y) return cur.path;
    for (const d of ["N", "E", "S", "W"] as Dir[]) {
      if (maze[cur.y]![cur.x]![d]) continue;
      const [dx, dy] = step[d];
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
      const key = `${nx},${ny}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ x: nx, y: ny, path: [...cur.path, d] });
    }
  }
  throw new Error("a perfect maze always has a route, so this is a generator bug");
}

const parseRoute = (a: unknown): Dir[] | null => {
  const dirs = ["N", "E", "S", "W"];
  if (typeof a === "string") {
    const route = a.toUpperCase().split("");
    return route.every((c) => dirs.includes(c)) ? (route as Dir[]) : null;
  }
  if (Array.isArray(a) && a.every((d) => typeof d === "string" && dirs.includes(d.toUpperCase()))) {
    return a.map((d) => (d as string).toUpperCase() as Dir);
  }
  return null;
};

export const toll: Problem = register({
  id: "toll",
  title: "Toll",
  category: "knowing what to buy",
  level: "easy",
  par: 1,
  statement:
    "A maze you cannot see, 8x8, entered at the top left and left at the bottom right. Ask what walls " +
    "a cell has, or buy the whole map; each costs the same. Then submit the route as a string of " +
    "compass letters. Looking at every cell costs sixty-four times what the map does; the map costs " +
    "the same as one look. The question is how little you can get away with.",
  harness: (seed) => ({
    probe: '{ "look": { "x": 0-7, "y": 0-7 } }  or  { "map": true }',
    answer: '"EESSEN...", the letters N, E, S and W, walked from the start',
    maze: { size: SIZE, start: START, exit: EXIT },
    note:
      "A maze is a function of its seed: recursive backtracking over the stream in " +
      "src/problems/seed.ts, in src/problems/toll.ts. Rebuild it, replay any route, and check a run yourself.",
    generator: GENERATOR,
    example: { seed, walls: mazeFrom(seed)[0]![0] },
  }),
  initialState: () => null,
  probe(seed, question, state) {
    const q = parse(question);
    if (!q) return null;
    const maze = mazeFrom(seed);
    if ("map" in q) return { answer: { map: maze }, state };
    return { answer: { at: q.look, walls: maze[q.look.y]![q.look.x]! }, state };
  },
  check(seed, answer) {
    const route = parseRoute(answer);
    return route !== null && walk(mazeFrom(seed), route);
  },
});
