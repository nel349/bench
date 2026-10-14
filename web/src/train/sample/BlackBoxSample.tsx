import type { BlackBoxSample as BlackBox } from "./sample.ts";

/** Room outside the grid, in cells, for the rays arriving and leaving. */
const PAD = 1.2;
const centre = (n: number) => n + 0.5;

/** How many steps Black Box's drawing takes: one per ray fired, then the atoms shown. */
export const blackBoxSteps = (s: BlackBox) => s.rays.length + 1;

/**
 * Black Box's grid, with rays fired in from its edges one per step by the gym's own physics, and the
 * atoms that bent them shown once the rays are all in.
 */
export function BlackBoxSample({ sample, label, step }: { readonly sample: BlackBox; readonly label: string; readonly step: number }) {
  const { size, atoms } = sample.board;
  const lines: string[] = [];
  for (let i = 0; i <= size; i++) lines.push(`M${i} 0v${size}`, `M0 ${i}h${size}`);
  const found = step > sample.rays.length;
  return (
    <svg className="sample-draw blackbox" viewBox={`${-PAD} ${-PAD} ${size + PAD * 2} ${size + PAD * 2}`} role="img" aria-label={label}>
      <path className="grid" d={lines.join("")} />
      {sample.rays.slice(0, step).map((ray, i) => (
        <polyline key={i} className={`ray ${ray.result.kind}`} points={ray.path.map((c) => `${centre(c.x)},${centre(c.y)}`).join(" ")} />
      ))}
      {found && atoms.map((a) => <circle key={`${a.x},${a.y}`} className="atom" cx={centre(a.x)} cy={centre(a.y)} r={0.3} />)}
    </svg>
  );
}
