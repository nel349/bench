import type { BisectSample as Bisect } from "./sample.ts";

/** The drawing's width, in its own units; the history is scaled to fit it. */
const WIDTH = 1000;
const BAR_Y = 34;
const BAR_H = 28;
/** How far a tested commit's tick reaches past the bar. */
const TICK = 8;

/** How many steps Bisect's drawing takes: one per commit tested, then the answer. */
export const bisectSteps = (s: Bisect) => s.probes.length + 1;

/**
 * Bisect's history as one bar, oldest commit on the left, and a search narrowing on the first bad
 * commit: each step tests one commit, ticked good or bad, and the range still in doubt is outlined.
 * The last step marks the answer.
 */
export function BisectSample({ sample, label, step }: { readonly sample: Bisect; readonly label: string; readonly step: number }) {
  const at = (commit: number) => (commit / sample.commits) * WIDTH;
  const tested = sample.probes.slice(0, step);
  const good = Math.max(0, ...tested.filter((p) => p.verdict === "good").map((p) => p.commit));
  const bad = Math.min(sample.commits - 1, ...tested.filter((p) => p.verdict === "bad").map((p) => p.commit));
  const solved = step > sample.probes.length;
  const last = tested[tested.length - 1];
  return (
    <svg className="sample-draw bisect" viewBox={`0 0 ${WIDTH} 110`} role="img" aria-label={label}>
      <rect className="history" x={0} y={BAR_Y} width={WIDTH} height={BAR_H} />
      {/* A run of a few commits is narrower than a pixel at this scale, so each is at least one wide. */}
      {sample.broken.map((s) => (
        <rect key={s.from} className="broken" x={at(s.from)} y={BAR_Y} width={Math.max(at(s.to + 1) - at(s.from), 1.5)} height={BAR_H} />
      ))}
      <rect className="doubt" x={at(good)} y={BAR_Y - 3} width={Math.max(at(bad) - at(good), 2)} height={BAR_H + 6} />
      {tested.map((p) => (
        <line key={p.commit} className={`probe ${p.verdict}`} x1={at(p.commit)} x2={at(p.commit)} y1={BAR_Y - TICK} y2={BAR_Y + BAR_H + TICK} />
      ))}
      {solved
        ? <text className="mark" x={at(sample.firstBad)} y={BAR_Y - 14} textAnchor="middle">{sample.firstBad}</text>
        : last && <text className="now" x={at(last.commit)} y={BAR_Y - 14} textAnchor="middle">{last.commit}</text>}
      <text className="end" x={0} y={BAR_Y + BAR_H + 26}>0</text>
      <text className="end" x={WIDTH} y={BAR_Y + BAR_H + 26} textAnchor="end">{sample.commits - 1}</text>
    </svg>
  );
}
