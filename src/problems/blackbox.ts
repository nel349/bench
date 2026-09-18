/**
 * Black Box: atoms hidden in a grid, found by firing rays at them.
 *
 * A ray enters from one edge cell and travels straight until something happens to it. Nothing about
 * the board is visible; the only way to learn anything is to pay for a ray. That is the whole reason
 * this problem is in the opening set — information has a price, and the skill is knowing when you
 * have bought enough of it.
 *
 * Boards are generated from a seed, and the generator is here in the open. Anyone can rebuild the
 * board a run was played on and replay every ray in it. A score nobody can check is our word for it.
 */

export type Dir = "up" | "down" | "left" | "right";
export interface Cell { readonly x: number; readonly y: number }
/** Where a ray enters or leaves: a side, and how far along it. */
export interface Port { readonly side: Dir; readonly index: number }

export type RayResult =
  /** Absorbed — the ray walked into an atom. */
  | { readonly kind: "hit" }
  /** Came back out of the port it went in by. */
  | { readonly kind: "reflect" }
  /** Left somewhere else. */
  | { readonly kind: "detour"; readonly exit: Port };

export interface Board {
  readonly size: number;
  readonly atoms: readonly Cell[];
}

const DELTA: Record<Dir, Cell> = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
};

/** Turning left and right, so a deflection is a lookup rather than four branches. */
const LEFT_OF: Record<Dir, Dir> = { up: "left", left: "down", down: "right", right: "up" };
const RIGHT_OF: Record<Dir, Dir> = { up: "right", right: "down", down: "left", left: "up" };

/**
 * A seeded generator, so a board is a function of its seed and nothing else.
 *
 * Deliberately small and written out rather than pulled from a library: a stranger reimplementing
 * this to check a run should not have to match a dependency's version. mulberry32.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function boardFrom(seed: number, size = 8, atomCount = 4): Board {
  const next = rng(seed);
  const taken = new Set<string>();
  const atoms: Cell[] = [];
  while (atoms.length < atomCount) {
    const x = Math.floor(next() * size);
    const y = Math.floor(next() * size);
    const key = `${x},${y}`;
    if (taken.has(key)) continue;
    taken.add(key);
    atoms.push({ x, y });
  }
  return { size, atoms };
}

const has = (b: Board, x: number, y: number): boolean => b.atoms.some((a) => a.x === x && a.y === y);
const inside = (b: Board, c: Cell): boolean => c.x >= 0 && c.y >= 0 && c.x < b.size && c.y < b.size;

/** The cell just inside the board from a port, and the direction a ray travels from there. */
function entry(b: Board, p: Port): { readonly at: Cell; readonly dir: Dir } {
  switch (p.side) {
    case "left":  return { at: { x: 0, y: p.index }, dir: "right" };
    case "right": return { at: { x: b.size - 1, y: p.index }, dir: "left" };
    case "up":    return { at: { x: p.index, y: 0 }, dir: "down" };
    case "down":  return { at: { x: p.index, y: b.size - 1 }, dir: "up" };
  }
}

/** Which port a ray leaving `from` in `dir` emerges at. */
function exitPort(b: Board, from: Cell, dir: Dir): Port {
  switch (dir) {
    case "right": return { side: "right", index: from.y };
    case "left":  return { side: "left", index: from.y };
    case "down":  return { side: "down", index: from.x };
    case "up":    return { side: "up", index: from.x };
  }
}

/**
 * Fire one ray and say what became of it.
 *
 * The rules are the classic ones, and the order they are checked in is what makes them agree with
 * the physical game. Before stepping into a cell, look at the two cells diagonally ahead: an atom on
 * one side turns the ray away from it, atoms on both send it back the way it came. Only then is the
 * cell itself checked for an atom, which absorbs the ray.
 *
 * The edge case that catches every implementation: an atom diagonally beside the entry port reflects
 * the ray immediately, before it has travelled at all.
 */
export function fire(b: Board, p: Port): RayResult {
  const start = entry(b, p);
  let dir = start.dir;
  let at: Cell = { x: start.at.x - DELTA[dir].x, y: start.at.y - DELTA[dir].y };

  for (let step = 0; step <= b.size * b.size * 4; step++) {
    const ahead: Cell = { x: at.x + DELTA[dir].x, y: at.y + DELTA[dir].y };

    if (inside(b, ahead) && has(b, ahead.x, ahead.y)) return { kind: "hit" };

    const l = LEFT_OF[dir], r = RIGHT_OF[dir];
    const diagL: Cell = { x: ahead.x + DELTA[l].x, y: ahead.y + DELTA[l].y };
    const diagR: Cell = { x: ahead.x + DELTA[r].x, y: ahead.y + DELTA[r].y };
    const atomL = inside(b, diagL) && has(b, diagL.x, diagL.y);
    const atomR = inside(b, diagR) && has(b, diagR.x, diagR.y);

    if (atomL && atomR) dir = LEFT_OF[LEFT_OF[dir]];
    else if (atomL) dir = r;
    else if (atomR) dir = l;
    else {
      at = ahead;
      if (!inside(b, at)) {
        const out = exitPort(b, { x: at.x - DELTA[dir].x, y: at.y - DELTA[dir].y }, dir);
        return out.side === p.side && out.index === p.index ? { kind: "reflect" } : { kind: "detour", exit: out };
      }
      continue;
    }

    // Deflected. If that turned the ray back out of where it came in, it reflected.
    const after: Cell = { x: at.x + DELTA[dir].x, y: at.y + DELTA[dir].y };
    if (!inside(b, after)) {
      if (!inside(b, at)) return { kind: "reflect" };
      const out = exitPort(b, at, dir);
      return out.side === p.side && out.index === p.index ? { kind: "reflect" } : { kind: "detour", exit: out };
    }
  }
  return { kind: "reflect" };
}

/** Did the guess name every atom? Order does not matter; count does. */
export function check(b: Board, guess: readonly Cell[]): boolean {
  if (guess.length !== b.atoms.length) return false;
  const want = new Set(b.atoms.map((a) => `${a.x},${a.y}`));
  const got = new Set(guess.map((g) => `${g.x},${g.y}`));
  return want.size === got.size && [...want].every((k) => got.has(k));
}

/** Every port, so a harness can enumerate what may be bought. */
export function ports(size: number): Port[] {
  const sides: Dir[] = ["up", "down", "left", "right"];
  return sides.flatMap((side) => Array.from({ length: size }, (_, index) => ({ side, index })));
}
