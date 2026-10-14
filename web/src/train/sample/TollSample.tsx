import type { TollSample as Toll } from "./sample.ts";

/** Room around the maze, in cells, so the start and exit marks are not cut off at the edge. */
const PAD = 0.4;
const centre = (n: number) => n + 0.5;

/** How many steps Toll's drawing takes: one for each cell of the route. */
export const tollSteps = (s: Toll) => s.path.length;

/**
 * Toll's maze, every wall in it, and the shortest route from the top left to the bottom right,
 * walked one cell per step; the exit lights when the route reaches it.
 */
export function TollSample({ sample, label, step }: { readonly sample: Toll; readonly label: string; readonly step: number }) {
  const size = sample.maze.length;
  const walls: string[] = [];
  sample.maze.forEach((row, y) => row.forEach((w, x) => {
    if (w.N) walls.push(`M${x} ${y}h1`);
    if (w.W) walls.push(`M${x} ${y}v1`);
    if (w.E && x === size - 1) walls.push(`M${x + 1} ${y}v1`);
    if (w.S && y === size - 1) walls.push(`M${x} ${y + 1}h1`);
  }));
  const walked = sample.path.slice(0, Math.max(step, 1));
  const head = walked[walked.length - 1]!;
  const exit = sample.path[sample.path.length - 1]!;
  const arrived = step >= sample.path.length;
  return (
    <svg className="sample-draw toll" viewBox={`${-PAD} ${-PAD} ${size + PAD * 2} ${size + PAD * 2}`} role="img" aria-label={label}>
      <path className="wall" d={walls.join("")} />
      <circle className={arrived ? "end" : "end dim"} cx={centre(exit.x)} cy={centre(exit.y)} r={0.18} />
      <polyline className="route" points={walked.map((c) => `${centre(c.x)},${centre(c.y)}`).join(" ")} />
      <circle className="end" cx={centre(sample.path[0]!.x)} cy={centre(sample.path[0]!.y)} r={0.18} />
      <circle className="head" cx={centre(head.x)} cy={centre(head.y)} r={0.26} />
    </svg>
  );
}
