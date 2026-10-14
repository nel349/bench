import type { RankingSample as Ranking } from "./sample.ts";

const WIDTH = 800;
const HEIGHT = 200;
const GAP = 16;
/** Room under the bars for the letters. */
const FOOT = 28;
/** How tall a bar is before its place is known: a stub, the same for all. */
const STUB = 10;

/** How many steps Ranking's drawing takes: one per item placed, then the question lit. */
export const rankingSteps = (s: Ranking) => s.order.length + 1;

/**
 * Ranking's hidden order, best first: each step raises the next bar to its height, and once all are
 * up the two items of one question are lit.
 */
export function RankingSample({ sample, label, step }: { readonly sample: Ranking; readonly label: string; readonly step: number }) {
  const n = sample.order.length;
  const bar = (WIDTH - GAP * (n - 1)) / n;
  const tallest = HEIGHT - FOOT;
  const asking = step > n;
  return (
    <svg className="sample-draw ranking" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label}>
      {[...sample.order].map((item, i) => {
        const h = i < step ? tallest * (n - i) / n : STUB;
        const x = i * (bar + GAP);
        const asked = asking && (item === sample.asked.a || item === sample.asked.b);
        return (
          <g key={item} className={asked ? "asked" : undefined}>
            <rect x={x} y={tallest - h} width={bar} height={h} />
            <text x={x + bar / 2} y={HEIGHT - 6} textAnchor="middle">{item}</text>
          </g>
        );
      })}
    </svg>
  );
}
