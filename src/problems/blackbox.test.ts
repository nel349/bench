import { expect, test, describe } from "bun:test";
import { trace, boardFrom, check, fire, ports, type Board, type Port } from "./blackbox.ts";

/** A board written out by hand, so the expected ray behaviour can be reasoned about rather than trusted. */
const board = (size: number, ...atoms: [number, number][]): Board =>
  ({ size, atoms: atoms.map(([x, y]) => ({ x, y })) });

describe("a ray that meets nothing goes straight through", () => {
  const empty = board(8);
  test("left to right, on every row", () => {
    for (let i = 0; i < 8; i++) {
      const r = fire(empty, { side: "left", index: i });
      expect(r.kind).toBe("detour");
      if (r.kind === "detour") expect(r.exit).toEqual({ side: "right", index: i });
    }
  });
  test("top to bottom, on every column", () => {
    for (let i = 0; i < 8; i++) {
      const r = fire(empty, { side: "up", index: i });
      expect(r.kind).toBe("detour");
      if (r.kind === "detour") expect(r.exit).toEqual({ side: "down", index: i });
    }
  });
});

describe("a ray that walks into an atom is absorbed", () => {
  test("head on", () => {
    expect(fire(board(8, [3, 4]), { side: "left", index: 4 }).kind).toBe("hit");
  });
  test("from the other side of the same row", () => {
    expect(fire(board(8, [3, 4]), { side: "right", index: 4 }).kind).toBe("hit");
  });
  test("from above, down the same column", () => {
    expect(fire(board(8, [3, 4]), { side: "up", index: 3 }).kind).toBe("hit");
  });
});

describe("an atom to one side turns the ray away from it", () => {
  test("an atom below deflects an eastbound ray upward, and it leaves the top", () => {
    // Atom at (3,5); a ray along row 4 is deflected before entering column 3.
    const r = fire(board(8, [3, 5]), { side: "left", index: 4 });
    expect(r.kind).toBe("detour");
    if (r.kind === "detour") expect(r.exit.side).toBe("up");
  });
  test("an atom above deflects it downward", () => {
    const r = fire(board(8, [3, 3]), { side: "left", index: 4 });
    expect(r.kind).toBe("detour");
    if (r.kind === "detour") expect(r.exit.side).toBe("down");
  });
});

describe("atoms on both sides send the ray back", () => {
  test("a pair astride the path reflects", () => {
    // Atoms at (3,3) and (3,5) straddle row 4: the ray cannot pass between them.
    expect(fire(board(8, [3, 3], [3, 5]), { side: "left", index: 4 }).kind).toBe("reflect");
  });
  test("an atom diagonally beside the entry reflects before the ray travels", () => {
    // Atom at (0,3) sits diagonally off the entry at row 4 on the left edge.
    expect(fire(board(8, [0, 3]), { side: "left", index: 4 }).kind).toBe("reflect");
  });
});

describe("a ray always ends", () => {
  test("no board and no port leaves one running", () => {
    for (const seed of Array.from({ length: 40 }, (_, i) => String(i))) {
      const b = boardFrom(seed);
      for (const p of ports(b.size)) {
        const r = fire(b, p);
        expect(["hit", "reflect", "detour"]).toContain(r.kind);
      }
    }
  });
});

describe("a board is a function of its seed, so a stranger can rebuild it", () => {
  test("the same seed gives the same atoms", () => {
    expect(boardFrom("12345").atoms).toEqual(boardFrom("12345").atoms);
  });
  test("different seeds give different boards", () => {
    expect(boardFrom("1").atoms).not.toEqual(boardFrom("2").atoms);
  });
  test("atoms never overlap and always fit", () => {
    for (const seed of Array.from({ length: 60 }, (_, i) => String(i))) {
      const b = boardFrom(seed);
      expect(b.atoms).toHaveLength(4);
      expect(new Set(b.atoms.map((a) => `${a.x},${a.y}`)).size).toBe(4);
      for (const a of b.atoms) {
        expect(a.x).toBeGreaterThanOrEqual(0); expect(a.x).toBeLessThan(b.size);
        expect(a.y).toBeGreaterThanOrEqual(0); expect(a.y).toBeLessThan(b.size);
      }
    }
  });
  test("the generator is uniform enough to be worth playing", () => {
    const seen = new Set<string>();
    for (const seed of Array.from({ length: 200 }, (_, i) => String(i))) for (const a of boardFrom(seed).atoms) seen.add(`${a.x},${a.y}`);
    expect(seen.size).toBeGreaterThan(50); // of 64 cells
  });
});

describe("checking a guess", () => {
  const b = board(8, [1, 1], [2, 2], [3, 3], [4, 4]);
  test("the right atoms in any order pass", () => {
    expect(check(b, [{ x: 4, y: 4 }, { x: 1, y: 1 }, { x: 3, y: 3 }, { x: 2, y: 2 }])).toBe(true);
  });
  test("one wrong atom fails", () => {
    expect(check(b, [{ x: 4, y: 4 }, { x: 1, y: 1 }, { x: 3, y: 3 }, { x: 2, y: 3 }])).toBe(false);
  });
  test("too few fails, and so does too many", () => {
    expect(check(b, [{ x: 1, y: 1 }])).toBe(false);
    expect(check(b, [...b.atoms, { x: 7, y: 7 }])).toBe(false);
  });
  test("duplicates do not pad a short guess into a passing one", () => {
    expect(check(b, [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }])).toBe(false);
  });
});

describe("the ports a harness may buy", () => {
  test("four sides of eight", () => {
    const p = ports(8);
    expect(p).toHaveLength(32);
    expect(new Set(p.map((x: Port) => `${x.side}:${x.index}`)).size).toBe(32);
  });
});

/**
 * The path, which the front page draws.
 *
 * `fire` is now built on `trace`, so the picture and the game cannot disagree about the rules — but
 * the path itself has invariants a renderer relies on, and a ray that jumped a cell would draw as a
 * line straight through an atom it should have hit.
 */
describe("trace", () => {
  const SEEDS = Array.from({ length: 200 }, (_, i) => String(i + 1));
  const adjacent = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
  const onBoard = (size: number, c: { x: number; y: number }) =>
    c.x >= 0 && c.y >= 0 && c.x < size && c.y < size;

  test("fire and trace agree on every port of every board", () => {
    for (const seed of SEEDS) {
      const b = boardFrom(seed);
      for (const p of ports(b.size)) expect(trace(b, p).result).toEqual(fire(b, p));
    }
  });

  test("every step is to a neighbouring cell: a ray never jumps", () => {
    for (const seed of SEEDS) {
      const b = boardFrom(seed);
      for (const p of ports(b.size)) {
        const { path } = trace(b, p);
        for (let i = 1; i < path.length; i++) expect(adjacent(path[i - 1]!, path[i]!)).toBe(true);
      }
    }
  });

  test("a ray starts just outside the board, at the port it was fired from", () => {
    const b = boardFrom("7");
    for (const p of ports(b.size)) {
      const first = trace(b, p).path[0]!;
      expect(onBoard(b.size, first)).toBe(false);
    }
  });

  test("an absorbed ray ends on an atom", () => {
    for (const seed of SEEDS) {
      const b = boardFrom(seed);
      for (const p of ports(b.size)) {
        const t = trace(b, p);
        if (t.result.kind !== "hit") continue;
        const last = t.path[t.path.length - 1]!;
        expect(b.atoms.some((a) => a.x === last.x && a.y === last.y)).toBe(true);
      }
    }
  });

  test("a ray that leaves ends just outside the board", () => {
    for (const seed of SEEDS) {
      const b = boardFrom(seed);
      for (const p of ports(b.size)) {
        const t = trace(b, p);
        if (t.result.kind !== "detour") continue;
        expect(onBoard(b.size, t.path[t.path.length - 1]!)).toBe(false);
      }
    }
  });

  test("no cell on a path is an atom except the one that absorbed it", () => {
    for (const seed of SEEDS) {
      const b = boardFrom(seed);
      for (const p of ports(b.size)) {
        const t = trace(b, p);
        const body = t.result.kind === "hit" ? t.path.slice(0, -1) : t.path;
        for (const c of body) expect(b.atoms.some((a) => a.x === c.x && a.y === c.y)).toBe(false);
      }
    }
  });
});
