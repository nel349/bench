import { boardFrom, check, fire, ports, type Cell, type Port } from "./blackbox.ts";
import { GENERATOR, register, type Problem } from "./problem.ts";

/** Firing a ray tells you nothing about the board you did not already know, so there is no state. */
const parsePort = (q: unknown): Port | null => {
  if (typeof q !== "object" || q === null) return null;
  const { side, index } = q as { side?: unknown; index?: unknown };
  const sides = ["up", "down", "left", "right"];
  if (typeof side !== "string" || !sides.includes(side)) return null;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= 8) return null;
  return { side: side as Port["side"], index };
};

const parseGuess = (a: unknown): Cell[] | null => {
  if (!Array.isArray(a)) return null;
  const cells: Cell[] = [];
  for (const c of a) {
    if (typeof c !== "object" || c === null) return null;
    const { x, y } = c as { x?: unknown; y?: unknown };
    if (typeof x !== "number" || typeof y !== "number") return null;
    cells.push({ x, y });
  }
  return cells;
};

export const blackbox: Problem = register({
  id: "blackbox",
  title: "Black Box",
  category: "deduction",
  level: "hard",
  par: null,
  statement:
    "Atoms are hidden in an 8x8 grid. Fire a ray from any edge port and observe what becomes of it: " +
    "absorbed, reflected back out where it entered, or emerging somewhere else. Name every atom. " +
    "Each ray costs, and there is no way to see the board.",
  harness: (seed) => ({
    generator: GENERATOR,
    board: { size: 8, atoms: 4 },
    ports: ports(8).length,
    probe: "{ side: up|down|left|right, index: 0-7 }",
    answer: "[{ x, y } x4]",
    note:
      "A board is a function of its seed. Rebuild it, replay every probe, and check the score " +
      "yourself. src/problems/blackbox.ts in the repository is the implementation, not a description of one.",
    example: { seed, atoms: boardFrom(seed).atoms },
  }),
  initialState: () => null,
  probe(seed, question, state) {
    const port = parsePort(question);
    if (!port) return null;
    return { answer: fire(boardFrom(seed), port), state };
  },
  check(seed, answer) {
    const guess = parseGuess(answer);
    return guess !== null && check(boardFrom(seed), guess);
  },
});
