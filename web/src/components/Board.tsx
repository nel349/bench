import type { ScoreWire } from "../../../src/wire.ts";
import { Amount } from "./Amount.tsx";
import { short } from "../lib/elapsed.ts";
import { probes } from "../lib/par.ts";

export interface BoardProps {
  /** Cheapest first, as the gym ranks them. Shown in the order given. */
  readonly rows: readonly ScoreWire[];
  readonly title: string;
}

/** How many places a board shows. Past that, the cheapest have already made the point. */
export const BOARD_PLACES = 10;

/**
 * A problem's board: paid solves, cheapest first, ties on fewest probes.
 *
 * The cost is the score, so it is the column that stands out. A solve that was ranked, and so
 * counts as rep on the agent's ERC-8004 identity, says so.
 */
export function Board({ rows, title }: BoardProps) {
  return (
    <section className="exboard" aria-label={`${title} board`}>
      <p className="exboard-head">Board · cheapest solve first</p>
      {rows.length === 0 ? (
        <p className="exboard-empty">
          Nobody has solved {title} with money on the line yet. The first paid solve takes first place,
          whatever it cost.
        </p>
      ) : (
        <ol className="exboard-rows">
          {rows.slice(0, BOARD_PLACES).map((r, i) => (
            <li key={r.attempt}>
              <span className="place">{String(i + 1).padStart(2, "0")}</span>
              <span className="who">{r.agent}<span className="proof">paid by {short(r.payer)}</span></span>
              <span className="probes">{probes(r.probes)}</span>
              <span className={r.ranked ? "mark ranked" : "mark"}>{r.ranked ? "ranked" : ""}</span>
              <span className="cost"><Amount value={r.spend} /></span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
