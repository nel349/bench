import type { LiarSample as Liar } from "./sample.ts";

const WIDTH = 1000;
const LINE_Y = 40;
const BOX_Y = 92;
const BOX_H = 34;
const BOX_GAP = 8;

/** How many steps Liar's drawing takes: one per answer, then the number found. */
export const liarSteps = (s: Liar) => s.window + 1;

/**
 * Liar's first answers, one per step, the lie among them lit as it arrives, and the hidden number
 * marked on the line of every number it could be once the answers are in.
 */
export function LiarSample({ sample, label, step }: { readonly sample: Liar; readonly label: string; readonly step: number }) {
  const x = (sample.number / (sample.numbers - 1)) * WIDTH;
  const box = (WIDTH - BOX_GAP * (sample.window - 1)) / sample.window;
  const found = step > sample.window;
  return (
    <svg className="sample-draw liar" viewBox={`0 0 ${WIDTH} 140`} role="img" aria-label={label}>
      <line className="line" x1={0} x2={WIDTH} y1={LINE_Y} y2={LINE_Y} />
      <text className="end" x={0} y={LINE_Y + 22}>0</text>
      <text className="end" x={WIDTH} y={LINE_Y + 22} textAnchor="end">{sample.numbers - 1}</text>
      {found && <line className="number" x1={x} x2={x} y1={LINE_Y - 12} y2={LINE_Y + 12} />}
      {found && <text className="mark" x={x} y={LINE_Y - 18} textAnchor="middle">{sample.number}</text>}
      {Array.from({ length: sample.window }, (_, i) => {
        const lie = i + 1 === sample.lie;
        const kind = i >= step ? "pending" : lie ? "lie" : "answer";
        return (
          <g key={i} className={kind}>
            <rect x={i * (box + BOX_GAP)} y={BOX_Y} width={box} height={BOX_H} />
            <text x={i * (box + BOX_GAP) + box / 2} y={BOX_Y + BOX_H / 2 + 5} textAnchor="middle">{i + 1}</text>
          </g>
        );
      })}
    </svg>
  );
}
