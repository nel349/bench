import { Amount } from "../components/Amount.tsx";
import type { Frame } from "./timeline.ts";
import { LEVEL_WEIGHT } from "../../../src/problems/problem.ts";
import { PRICE } from "../../../src/pricing.ts";
import { blackbox } from "../../../src/problems/blackbox-problem.ts";

export interface ReadoutProps {
  readonly seed: number;
  readonly frame: Frame;
  readonly atoms: number;
  readonly budget: number;
  /** In micro-USDC. */
  readonly price: number;
}

const decimal = (micros: number): string => (micros / 1_000_000).toFixed(6);

/** What a first ranked breach of Black Box adds to a rating: its level's weight, from the gym itself. */
const BLACK_BOX_REP = LEVEL_WEIGHT[blackbox.level];
/** The ranking fee in words, small, because it is a footnote to the spend and not a second headline. */
const RANK_PRICE = `$${(Number(PRICE.rank) / 1_000_000).toFixed(2)}`;

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
          <><span>BREACHED · +{BLACK_BOX_REP} REP</span><Amount value={decimal(spent)} /><span className="rep">once ranked, for {RANK_PRICE}</span></>
        )}
        {frame.ending === "refused" && (
          <><span>FLATLINED · NO REP</span><Amount value={decimal(spent)} /><span className="rep">spent for nothing</span></>
        )}
        {frame.ending === null && <span className="running-label">BUILDING REP</span>}
      </div>
    </aside>
  );
}
