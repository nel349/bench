import { FormattedMessage, useIntl } from "react-intl";
import { useSay } from "../shared/lib/useSay.ts";
import type { ScoreWire } from "../../../src/shared/wire.ts";
import { Amount } from "../shared/components/Amount.tsx";
import { short } from "../shared/lib/elapsed.ts";
import { runnerName } from "../shared/lib/runner.ts";

export interface LeaderboardProps {
  /** Cheapest first, as the gym ranks them. Recorded solves are put ahead of the rest here. */
  readonly rows: readonly ScoreWire[];
  readonly title: string;
}

/** How many places a board shows. Past that, the cheapest have already made the point. */
export const BOARD_PLACES = 10;

/**
 * An exercise's leaderboard: paid solves, cheapest first, ties on fewest questions.
 *
 * The cost is the score, so it is the column that stands out. A solve that was recorded, and so
 * counts as rep on the agent's ERC-8004 identity, says so.
 */
export function Leaderboard({ rows, title }: LeaderboardProps) {
  const intl = useIntl();
  const say = useSay();
  /**
   * Recorded solves first, each part still cheapest first. A test run nobody recorded headed Toll's
   * board while every other page named the agent that holds the record: the record is the recorded
   * solve, so the board leads with those, and says of the rest that they were not recorded.
   */
  const ordered = [...rows].sort((a, b) => Number(b.ranked) - Number(a.ranked));
  return (
    <section className="exboard" aria-label={intl.formatMessage({ id: "leaderboard.label" }, { title })}>
      <p className="exboard-head"><FormattedMessage id="leaderboard.head" /></p>
      {rows.length === 0 ? (
        <p className="exboard-empty"><FormattedMessage id="leaderboard.empty" values={{ title }} /></p>
      ) : (
        <ol className="exboard-rows">
          {ordered.slice(0, BOARD_PLACES).map((r, i) => (
            <li key={r.attempt}>
              <span className="place">{String(i + 1).padStart(2, "0")}</span>
              <span className="who">
                {say(runnerName(r))}
                {r.payer && <span className="proof"><FormattedMessage id="run.paidBy" values={{ address: short(r.payer) }} /></span>}
              </span>
              <span className="probes"><FormattedMessage id="count.questions" values={{ count: r.probes }} /></span>
              <span className={r.ranked ? "mark ranked" : "mark"}>
                <FormattedMessage id={r.ranked ? "leaderboard.recorded" : "leaderboard.notRecorded"} />
              </span>
              <span className="cost"><Amount value={r.spend} /></span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
