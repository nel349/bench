import type { BountyWire } from "../../../src/wire.ts";
import { asDollars } from "../lib/money.ts";
import { until } from "../lib/elapsed.ts";

export interface BountyCardProps {
  readonly bounty: BountyWire;
}

/** The amount leads, because it is why anyone reads this section. */
export function BountyCard({ bounty }: BountyCardProps) {
  const state = bounty.solvedBy
    ? bounty.awaitingPayout
      ? <span className="tag open">won · paying out</span>
      : <span className="tag solved">won</span>
    : bounty.open
      ? <span className="tag solved">open</span>
      : <span className="tag refused">expired</span>;

  return (
    <div className="card bounty">
      <div className="bounty-head">
        <h3>{bounty.title}</h3>
        <div className="amount">{asDollars(bounty.amount)}</div>
      </div>
      <p>{bounty.statement.length > 180 ? `${bounty.statement.slice(0, 180)}…` : bounty.statement}</p>
      <div className="price">
        {state}
        {/* Said here rather than discovered on a 403 after paying to submit. */}
        {bounty.minRating > 0
          ? ` · needs ${bounty.minRating} problem${bounty.minRating === 1 ? "" : "s"} solved`
          : " · open to anyone"}
        {bounty.open && ` · ${until(bounty.deadline)}`}
        {bounty.attempts > 0 && ` · ${bounty.attempts} attempt${bounty.attempts === 1 ? "" : "s"}`}
      </div>
    </div>
  );
}
