import type { Cell } from "../../../src/problems/blackbox.ts";
import type { Frame } from "./timeline.ts";

export interface BlackBoxFieldProps {
  readonly size: number;
  readonly frame: Frame;
  readonly price: string;
}

/**
 * Room outside the lattice, which is not the same on every side.
 *
 * A price on a left or right port is anchored outward and runs about a cell and a half past it, so the
 * sides need 3.2. A price on a top or bottom port is centred on it and needs far less. A square drawing
 * with 3.2 all round reserved height the board never used — the header floated off the top and the
 * narration off the bottom, with dead bands between. So the drawing is the shape its contents are.
 */
const MARGIN_X = 3.2;
const MARGIN_Y = 2.1;

/** Away from the lattice, for each side a probe can be fired from. */
const OUTWARD = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
} as const;

const points = (cells: readonly Cell[]) => cells.map((c) => `${c.x},${c.y}`).join(" ");

/**
 * A sealed lattice of ICE, projected like a hologram and probed one packet at a time.
 *
 * It is the Black Box game, by its real rules. The data cores are dark until a probe breaches one;
 * every probe that has been paid for leaves its trace glowing in the lattice; and the one that the
 * money ran out on is cut off in red, where the ICE caught it.
 */
export function BlackBoxField({ size, frame, price }: BlackBoxFieldProps) {
  const width = size - 1 + MARGIN_X * 2;
  const height = size - 1 + MARGIN_Y * 2;
  const edge = { min: -0.5, max: size - 0.5 };
  const nodes: Cell[] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) nodes.push({ x, y });
  const flatlined = frame.ending === "refused";

  return (
    <div className={`holo ${flatlined ? "flatline" : ""} ${frame.ending === "solved" ? "breached" : ""}`}
         style={{ opacity: frame.opacity, aspectRatio: `${width} / ${height}` }}>
      <svg className="lattice" viewBox={`${-MARGIN_X} ${-MARGIN_Y} ${width} ${height}`} role="img"
           aria-label={`An ICE lattice. ${frame.bought} probes bought, ${frame.found.length} data cores breached.`}>
        <defs>
          <filter id="glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="0.1" result="a" />
            <feGaussianBlur stdDeviation="0.3" result="b" in="SourceGraphic" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="a" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <radialGradient id="core-halo">
            <stop offset="0" stopColor="#ff2e88" stopOpacity="0.9" />
            <stop offset="1" stopColor="#ff2e88" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* The lattice: lines of light, which is what cyberspace was always drawn as. */}
        <g className="grid">
          {Array.from({ length: size + 1 }, (_, i) => edge.min + i).map((v) => (
            <g key={v}>
              <line x1={edge.min} y1={v} x2={edge.max} y2={v} />
              <line x1={v} y1={edge.min} x2={v} y2={edge.max} />
            </g>
          ))}
        </g>
        <rect className="bound" x={edge.min} y={edge.min} width={size} height={size} />

        {nodes.map((c) => <rect key={`${c.x}-${c.y}`} className="node"
                                x={c.x - 0.035} y={c.y - 0.035} width={0.07} height={0.07} />)}

        {/* Every probe already paid for stays lit, so the lattice fills with what was learned. */}
        {frame.trails.map((ray, i) => (
          <polyline key={i} className="trace" points={points(ray.trace.path)} />
        ))}

        {/*
          * No CSS animation or CSS transform on anything in here. This SVG sits inside a hologram
          * with a 3D perspective, and Chrome gives an animated SVG child its own compositing layer —
          * which, inside a 3D parent, it then places wrong or not at all. The cores had a CSS pop and
          * a CSS pulse: the DOM held them at the right cells, at full opacity, magenta, and nothing
          * was painted. Traces had neither and always drew. So every animation here is SVG's own.
          */}
        {frame.found.map((a) => (
          <g key={`${a.x}-${a.y}`} className="core">
            <circle cx={a.x} cy={a.y} r={0.62} fill="url(#core-halo)" className="core-halo">
              <animate attributeName="opacity" values="0.55;1;0.55" dur="2.4s" repeatCount="indefinite" />
            </circle>
            <circle cx={a.x} cy={a.y} r={0.2} className="core-burst">
              <animate attributeName="r" from="0.2" to="1.1" dur="0.7s" fill="freeze" />
              <animate attributeName="opacity" from="0.9" to="0" dur="0.7s" fill="freeze" />
            </circle>
            <polygon className="core-body"
                     points={`${a.x},${a.y - 0.26} ${a.x + 0.26},${a.y} ${a.x},${a.y + 0.26} ${a.x - 0.26},${a.y}`} />
          </g>
        ))}

        {frame.active && (
          <g className={frame.active.ray.refused ? "probe ice" : "probe"}>
            <polyline points={points(frame.active.drawn)} className="probe-line" />
            <circle cx={frame.active.head.x} cy={frame.active.head.y} r={0.12}
                    className="probe-head" filter="url(#glow)" />
            {frame.active.halted && (
              <g className="caught">
                <circle cx={frame.active.head.x} cy={frame.active.head.y} r={0.34} />
                <line x1={frame.active.head.x - 0.22} y1={frame.active.head.y - 0.22}
                      x2={frame.active.head.x + 0.22} y2={frame.active.head.y + 0.22} />
                <line x1={frame.active.head.x - 0.22} y1={frame.active.head.y + 0.22}
                      x2={frame.active.head.x + 0.22} y2={frame.active.head.y - 0.22} />
              </g>
            )}
          </g>
        )}

        {/* A debit, at the port it was paid from, drifting out as it fades. */}
        {frame.prices.map((p, i) => {
          const out = OUTWARD[p.side];
          return (
            <text key={i} className={p.refused ? "debit ice" : "debit"}
                  x={p.at.x + out.x * p.reach} y={p.at.y + out.y * p.reach}
                  textAnchor={out.x < 0 ? "end" : out.x > 0 ? "start" : "middle"}
                  opacity={p.opacity}>
              {p.refused ? "NO FUNDS" : `−${price}`}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
