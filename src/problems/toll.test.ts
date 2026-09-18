import { expect, test, describe } from "bun:test";
import { mazeFrom, toll, walk, START, EXIT, type Dir, type Walls } from "./toll.ts";
import { Attempts } from "../attempt.ts";
import { InMemoryAllowance } from "../payments.ts";
import { usdc, format } from "../money.ts";

const SIZE = 8;

/** Breadth-first through the openings, so the tests know the answer without trusting the checker. */
function shortestRoute(maze: Walls[][]): Dir[] {
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

describe("the maze is a maze", () => {
  test("every seed produces one that can be finished", () => {
    for (let seed = 0; seed < 40; seed++) {
      const route = shortestRoute(mazeFrom(seed));
      expect(route.length).toBeGreaterThan(0);
      expect(walk(mazeFrom(seed), route)).toBe(true);
    }
  });

  test("walls agree between neighbours — no one-way doors", () => {
    const maze = mazeFrom(4242);
    const opposite: Record<Dir, Dir> = { N: "S", E: "W", S: "N", W: "E" };
    const step: Record<Dir, readonly [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      for (const d of ["N", "E", "S", "W"] as Dir[]) {
        const [dx, dy] = step[d];
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
        expect(maze[y]![x]![d]).toBe(maze[ny]![nx]![opposite[d]]);
      }
    }
  });

  test("the same seed gives the same maze, and different seeds do not", () => {
    expect(mazeFrom(7)).toEqual(mazeFrom(7));
    expect(mazeFrom(7)).not.toEqual(mazeFrom(8));
  });
});

describe("the checker replays the route and takes nothing on trust", () => {
  const seed = 4242;
  test("the shortest route passes", () => {
    expect(toll.check(seed, shortestRoute(mazeFrom(seed)).join(""))).toBe(true);
  });
  test("an array of directions works as well as a string", () => {
    expect(toll.check(seed, shortestRoute(mazeFrom(seed)))).toBe(true);
  });
  test("a route that walks through a wall fails", () => {
    const route = shortestRoute(mazeFrom(seed));
    const wrong = route.map((d, i) => (i === 0 ? ({ N: "S", E: "W", S: "N", W: "E" } as const)[d] : d));
    expect(toll.check(seed, wrong)).toBe(false);
  });
  test("a route that stops short fails", () => {
    expect(toll.check(seed, shortestRoute(mazeFrom(seed)).slice(0, -1))).toBe(false);
  });
  test("an empty route, nonsense, and the wrong type all fail", () => {
    for (const bad of ["", "XYZ", [], null, 42, {}]) expect(toll.check(seed, bad)).toBe(false);
  });
  test("a route from a different maze does not pass this one", () => {
    expect(toll.check(seed, shortestRoute(mazeFrom(seed + 1)).join(""))).toBe(false);
  });
});

describe("probing", () => {
  const seed = 4242;
  test("a look returns that cell's walls and nothing else", () => {
    const out = toll.probe(seed, { look: { x: 3, y: 4 } }, null);
    expect(out!.answer).toEqual({ at: { x: 3, y: 4 }, walls: mazeFrom(seed)[4]![3]! });
  });
  test("the map returns the whole thing", () => {
    const out = toll.probe(seed, { map: true }, null);
    expect((out!.answer as { map: Walls[][] }).map).toEqual(mazeFrom(seed));
  });
  test("a look outside the maze does not parse, so is not charged for", () => {
    for (const bad of [{ look: { x: 8, y: 0 } }, { look: { x: -1, y: 0 } }, { look: {} }, {}, "map"]) {
      expect(toll.probe(seed, bad, null)).toBeNull();
    }
  });
});

/** The decision the problem exists to pose, priced. */
describe("the map costs one probe; looking everywhere costs sixty-four", () => {
  test("buying the map solves it for two cents", async () => {
    const money = new InMemoryAllowance();
    money.grant("agent:mapper", usdc("5"));
    const attempts = new Attempts(money);
    const a = attempts.start("agent:mapper", "toll", 4242)!;

    const seen = await attempts.ask(a.id, { map: true });
    const maze = ((seen as { answer: { map: Walls[][] } }).answer).map;
    await attempts.submit(a.id, shortestRoute(maze).join(""));

    const done = attempts.get(a.id)!;
    expect(done.outcome).toBe("solved");
    expect(format(done.spend)).toBe("0.020000");
  });

  test("looking at every cell instead costs $1.28, sixty-four times over", async () => {
    const money = new InMemoryAllowance();
    money.grant("agent:crawler", usdc("5"));
    const attempts = new Attempts(money);
    const a = attempts.start("agent:crawler", "toll", 4242)!;

    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) await attempts.ask(a.id, { look: { x, y } });
    expect(format(attempts.get(a.id)!.spend)).toBe("1.280000");
  });

  test("a tight budget stops the crawler and leaves the mapper alone", async () => {
    const money = new InMemoryAllowance();
    money.grant("agent:crawler", usdc("5"));
    const attempts = new Attempts(money);
    const a = attempts.start("agent:crawler", "toll", 4242, usdc("0.10"))!;
    for (let i = 0; i < 6; i++) await attempts.ask(a.id, { look: { x: i, y: 0 } });
    expect(attempts.get(a.id)!.outcome).toBe("refused");
  });
});
