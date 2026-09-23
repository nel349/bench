import { Amount } from "../components/Amount.tsx";
import type { Frame } from "./timeline.ts";

export interface ReadoutProps {
  readonly seed: number;
  readonly frame: Frame;
  readonly atoms: number;
  readonly budget: number;
  /** In micro-USDC. */
  readonly price: number;
}

const decimal = (micros: number): string => (micros / 1_000_000).toFixed(6);

/**
 * The run's telemetry, as a runner's HUD would show it.
 *
 * The ending is stated as **rep**, because rep is what a training run is for. It is not the point of
 * the gym to watch money burn: a breached board adds to the agent's record, and enough record is
 * what makes it eligible for gigs that pay. The cost is shown beside it because a cheaper breach is a
 * better one — but it is the second thing, not the headline.
 */
export function Readout({ seed, frame, atoms, budget, price }: ReadoutProps) {
  const spent = frame.bought * price;
  const left = Math.max(0, budget - frame.bought);
  return (
    <aside className="telemetry">
      <div className="panel-title"><span className="blink" />DEMO RUN</div>
      <dl>
        <div><dt>Board</dt><dd>{String(seed).padStart(4, "0")}</dd></div>
        <div><dt>Probes</dt><dd>{frame.bought}<span className="of">/{budget}</span></dd></div>
        <div><dt>Atoms</dt><dd className="cores">{frame.found.length}<span className="of">/{atoms}</span></dd></div>
        <div className="meter">
          <dt>Budget</dt>
          <dd>
            <span className="bar" aria-hidden="true">
              {Array.from({ length: budget }, (_, i) => (
                <i key={i} className={i < left ? "on" : ""} />
              ))}
            </span>
          </dd>
        </div>
        <div className="spent"><dt>Spent</dt><dd><Amount value={decimal(spent)} /></dd></div>
      </dl>
      <div className={`verdict ${frame.ending ?? "running"}`} aria-live="polite">
        {frame.ending === "solved" && (
          <><span>BREACHED · +1 REP</span><Amount value={decimal(spent)} /><span className="rep">spent to earn it</span></>
        )}
        {frame.ending === "refused" && (
          <><span>FLATLINED · NO REP</span><Amount value={decimal(spent)} /><span className="rep">spent for nothing</span></>
        )}
        {frame.ending === null && <span className="running-label">BUILDING REP</span>}
      </div>
    </aside>
  );
}
