import { FormattedMessage } from "react-intl";
import { display } from "../../../../src/shared/money.ts";
import { Amount } from "../../shared/components/Amount.tsx";
import type { Frame } from "./timeline.ts";
import { LEVEL_WEIGHT } from "../../../../src/problems/problem.ts";
import { PRICE } from "../../../../src/shared/pricing.ts";
import { blackbox } from "../../../../src/problems/blackbox.ts";

export interface ReadoutProps {
  readonly seed: number;
  readonly frame: Frame;
  readonly atoms: number;
  readonly budget: number;
  /** In micro-USDC. */
  readonly price: number;
}

const decimal = (micros: number): string => (micros / 1_000_000).toFixed(6);

/** What a first recorded solve of Black Box adds to rep: its level's weight, from the gym itself. */
const BLACK_BOX_REP = LEVEL_WEIGHT[blackbox.level];
/** The fee to record a solve, small, because it is a footnote to the spend and not a second headline. */
const RECORD_PRICE = display(PRICE.rank);

/**
 * The run's telemetry, as a runner's HUD would show it.
 *
 * The ending is stated as **rep**, because rep is what a training run is for. It is not the point of
 * the gym to watch money burn: a solved puzzle adds to the agent's record, and enough record is
 * what makes it eligible for gigs that pay. The cost is shown beside it because a cheaper solve is a
 * better one, but it is the second thing, not the headline.
 */
export function Readout({ seed, frame, atoms, budget, price }: ReadoutProps) {
  const spent = frame.bought * price;
  const left = Math.max(0, budget - frame.bought);
  return (
    <aside className="telemetry">
      <div className="panel-title"><span className="blink" /><FormattedMessage id="demo.run" /></div>
      <dl>
        <div className="t-puzzle"><dt><FormattedMessage id="demo.puzzle" /></dt><dd>{String(seed).padStart(4, "0")}</dd></div>
        <div><dt><FormattedMessage id="demo.questions" /></dt><dd>{frame.bought}<span className="of">/{budget}</span></dd></div>
        <div>
          <dt><FormattedMessage id="demo.atoms" /></dt>
          <dd className="cores">{frame.found.length}<span className="of">/{atoms}</span></dd>
        </div>
        <div className="meter">
          <dt><FormattedMessage id="demo.budget" /></dt>
          <dd>
            <span className="bar" aria-hidden="true">
              {Array.from({ length: budget }, (_, i) => (
                <i key={i} className={i < left ? "on" : ""} />
              ))}
            </span>
          </dd>
        </div>
        <div className="spent"><dt><FormattedMessage id="demo.spent" /></dt><dd><Amount value={decimal(spent)} /></dd></div>
      </dl>
      <p className="budget-note"><FormattedMessage id="demo.budgetNote" values={{ budget }} /></p>
      <div className={`verdict ${frame.ending ?? "running"}`} aria-live="polite">
        {frame.ending === "solved" && (
          <>
            <span><FormattedMessage id="demo.solved" values={{ rep: BLACK_BOX_REP }} /></span>
            <Amount value={decimal(spent)} />
            <span className="rep"><FormattedMessage id="demo.solvedNote" values={{ price: RECORD_PRICE }} /></span>
          </>
        )}
        {frame.ending === "refused" && (
          <>
            <span><FormattedMessage id="demo.ranOut" /></span>
            <Amount value={decimal(spent)} />
            <span className="rep"><FormattedMessage id="demo.ranOutNote" /></span>
          </>
        )}
        {frame.ending === null && <span className="running-label"><FormattedMessage id="demo.solving" /></span>}
      </div>
    </aside>
  );
}
