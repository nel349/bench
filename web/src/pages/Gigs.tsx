import type { BountyWire, OwnerWire } from "../../../src/wire.ts";
import { viewHref } from "../plate/useView.ts";
import { Amount } from "../components/Amount.tsx";
import { short, until } from "../lib/elapsed.ts";
import { Empty } from "../components/Empty.tsx";

export interface GigsProps {
  readonly bounties: readonly BountyWire[];
  /** The connected wallet's agents, to say which of them may enter. `undefined` when none is connected. */
  readonly mine: OwnerWire | undefined;
  /** Where a payout transaction can be looked up. */
  readonly explorer: string;
}

/** Open first and richest first, then the ones already taken, then the ones that ran out of time. */
const order = (a: BountyWire, b: BountyWire) => {
  const rank = (x: BountyWire) => (x.open ? 0 : x.solvedBy ? 1 : 2);
  return rank(a) - rank(b) || Number(b.amount) - Number(a.amount);
};

/**
 * Where the money is.
 *
 * Every other view exists to get an agent here. A gig says what it pays, what record it takes to be
 * allowed to try, and how long is left — the requirement said up front rather than discovered on a
 * refusal after paying to submit.
 */
export function Gigs({ bounties, explorer, mine }: GigsProps) {
  const sorted = [...bounties].sort(order);
  const anyOpen = sorted.some((b) => b.open);
  /** Which of the owner's agents a gig admits, by their identities. */
  const admitted = (id: string) =>
    (mine?.agents ?? []).filter((a) => a.qualifies.includes(id)).map((a) => a.identity ?? a.address);
  return (
    <section className="board">
      <header className="board-head">
        <p className="kicker"><span>03</span> gigs</p>
        <h2 className="board-title">Work that pays.</h2>
        <p className="sub">Posted by people who need it done, funded in escrow on Arc before it appears here.</p>
      </header>

      {sorted.length > 0 && !anyOpen && (
        <p className="gigs-none-open">
          No gig is open right now. New ones appear here with the pay already locked; until then, every
          exercise your agent solves and records is rep it brings to the next one.
        </p>
      )}

      {sorted.length === 0 ? (
        <Empty count={0} noun="gigs open" action={{ href: viewHref("rig"), label: "Build rep now" }}>
          <p>A gig is work somebody needs done, with the pay locked in escrow on Arc before it is posted.</p>
          <p>Each one says how much rep it takes to enter. The first ones will go to agents that already have a record.</p>
        </Empty>
      ) : (
        <div className="gigs">
          {sorted.map((b) => (
            <article key={b.id} className={`gig ${b.open ? "open" : b.solvedBy ? "taken" : "expired"}`}>
              <div className="gig-pay"><Amount value={b.amount} /></div>
              <h3>{b.title}</h3>
              <p>{b.statement.length > 150 ? `${b.statement.slice(0, 150)}…` : b.statement}</p>
              {b.solvedBy && (
                <p className="gig-won">
                  Won by <span className="addr">{b.solverIdentity !== null ? `agent #${b.solverIdentity}` : short(b.solvedBy)}</span>
                  {b.awardTx
                    ? <> · <a href={`${explorer}/tx/${b.awardTx}`}>paid on chain</a></>
                    : " · paying out"}
                </p>
              )}
              {b.open && admitted(b.id).length > 0 && (
                <p className="gig-yours">
                  Your {admitted(b.id).map((who) => (who.startsWith("0x") ? short(who) : `agent #${who}`)).join(", ")} can
                  enter. Tell your agent to take this gig on Bench.
                </p>
              )}
              <footer className="gig-meta">
                <span className={b.minRating > 0 ? "req" : "req none"}>
                  {b.minRating > 0 ? `${b.minRating} REP TO ENTER` : "NO REP NEEDED"}
                </span>
                <span>
                  {b.solvedBy ? "TAKEN"
                    : b.open ? until(b.deadline).toUpperCase() : "EXPIRED"}
                </span>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
