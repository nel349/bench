import { FormattedMessage, useIntl } from "react-intl";
import { phrase } from "../shared/lib/phrase.ts";
import { useSay } from "../shared/lib/useSay.ts";
import type { BountyWire, OwnerWire } from "../../../src/shared/wire.ts";
import { viewHref } from "../shell/useView.ts";
import { Amount } from "../shared/components/Amount.tsx";
import { short, until } from "../shared/lib/elapsed.ts";
import { Empty } from "../shared/components/Empty.tsx";

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
  const say = useSay();
  const intl = useIntl();
  /** An agent by its number, or by its address where it has none. */
  const named = (who: string) => (who.startsWith("0x") ? short(who) : say(phrase("run.agentNumber", { id: who })));
  const sorted = [...bounties].sort(order);
  const anyOpen = sorted.some((b) => b.open);
  /** Which of the owner's agents a gig admits, by their identities. */
  const admitted = (id: string) =>
    (mine?.agents ?? []).filter((a) => a.qualifies.includes(id)).map((a) => a.identity ?? a.address);
  return (
    <section className="board">
      <header className="board-head">
        <p className="kicker"><span>03</span> <FormattedMessage id="gigs.kicker" /></p>
        <h2 className="board-title"><FormattedMessage id="gigs.title" /></h2>
        <p className="sub"><FormattedMessage id="gigs.sub" /></p>
      </header>

      {sorted.length > 0 && !anyOpen && (
        <p className="gigs-none-open"><FormattedMessage id="gigs.noneOpen" /></p>
      )}

      {sorted.length === 0 ? (
        <Empty count={0} noun={<FormattedMessage id="gigs.emptyNoun" />}
               action={{ href: viewHref("rig"), label: <FormattedMessage id="gigs.emptyAction" /> }}>
          <p><FormattedMessage id="gigs.empty1" /></p>
          <p><FormattedMessage id="gigs.empty2" /></p>
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
                  <FormattedMessage id="gigs.wonBy" values={{
                    who: <span className="addr">{named(b.solverIdentity ?? b.solvedBy)}</span>,
                  }} />
                  {" · "}
                  {b.awardTx
                    ? <a href={`${explorer}/tx/${b.awardTx}`}><FormattedMessage id="gigs.paidOnChain" /></a>
                    : <FormattedMessage id="gigs.payingOut" />}
                </p>
              )}
              {b.open && admitted(b.id).length > 0 && (
                <p className="gig-yours">
                  <FormattedMessage id="gigs.yoursCanEnter" values={{ agents: intl.formatList(admitted(b.id).map(named)) }} />
                </p>
              )}
              <footer className="gig-meta">
                <span className={b.minRating > 0 ? "req" : "req none"}>
                  {b.minRating > 0
                    ? <FormattedMessage id="gigs.needsRep" values={{ n: b.minRating }} />
                    : <FormattedMessage id="gigs.noRep" />}
                </span>
                <span>
                  {b.solvedBy ? <FormattedMessage id="gigs.won" />
                    : b.open ? say(until(b.deadline)) : <FormattedMessage id="gigs.expired" />}
                </span>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
