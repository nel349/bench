import { FormattedMessage } from "react-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { viewHref } from "../shell/useView.ts";
import { useBounties, useOwner, useProblems, useStandings } from "../shared/api/useGym.ts";
import { OwnerAgent } from "./OwnerAgent.tsx";
import { placeOf } from "./place.ts";
import { byLevel } from "../train/order.ts";
import { Empty } from "../shared/components/Empty.tsx";
import { isWallet } from "../shared/lib/ownerWallet.ts";
import { sinceSummary, useLastVisit } from "./lastVisit.ts";
import { Amount } from "../shared/components/Amount.tsx";
import { short } from "../shared/lib/elapsed.ts";
import { LEVEL_WEIGHT } from "../../../src/problems/problem.ts";
import { PATHS } from "../../../src/shared/paths.ts";

export interface YoursProps {
  /** The wallet the address bar names: the part of `#yours/…` after the view. */
  readonly wallet: string;
  /** Called once with a wallet when its page is shown, so this browser may keep it as the connected one. */
  readonly offer: (wallet: string) => void;
  /** Called with an address its owner typed in, which is asking for it. */
  readonly connect: (wallet: string) => void;
  /** Called as the owner leaves for the wallet's own Connect. */
  readonly onConnect: () => void;
  /** Where Connect wallet goes, or `null` where no wallet serves this network. */
  readonly connectHref: string | null;
  /** Where a transaction can be looked up. */
  readonly explorer: string;
  /** This gym's address, for the sentence that sends an agent to train. */
  readonly gym: string;
  /** The owner's wallet app, where an allowance is changed or revoked. `null` where none serves this network. */
  readonly walletUrl: string | null;
}

/**
 * The owner's own page, and where a connected owner lands: their wallet's agents, what each is doing
 * now, where it stands among the others, and what it has spent and earned.
 *
 * Reached by the link an agent gives when it starts training, or the wallet's own link, and kept
 * in the URL so it can be bookmarked. Everything on it is public, so it asks for nothing but the
 * wallet's address.
 */
export function Yours({ wallet, offer, connect, onConnect, connectHref, explorer, gym, walletUrl }: YoursProps) {
  const valid = isWallet(wallet);
  const owner = useOwner(valid ? wallet : null);
  const problems = useProblems();
  const bounties = useBounties();
  const standings = useStandings();
  // Once for each wallet shown, not on every refresh of its data: a wallet its owner had just
  // disconnected was being connected again by the next poll.
  const shown = valid && owner.data !== undefined;
  const offered = useRef<string | null>(null);
  // A different wallet's page, or none, starts again: the same wallet opened later is offered afresh.
  useEffect(() => { offered.current = null; }, [wallet]);
  useEffect(() => {
    if (!shown || offered.current === wallet) return;
    offered.current = wallet;
    offer(wallet);
  }, [shown, wallet, offer]);

  const since = useLastVisit(valid ? wallet : null, shown);
  // Of the agents it grants to now: what an agent it does not grant to did is not this visit's news.
  const summary = since !== null && owner.data
    ? sinceSummary(owner.data.agents.filter((a) => a.current).flatMap((a) => a.runs), since) : null;
  const exercises = byLevel(problems.data ?? []);
  const ceiling = exercises.reduce((t, p) => t + LEVEL_WEIGHT[p.level], 0);
  const gigsOf = (ids: readonly string[]) => (bounties.data ?? []).filter((b) => ids.includes(b.id));

  return (
    <section className="board yours">
      <header className="board-head">
        <p className="kicker"><span>//</span> <FormattedMessage id="yours.kicker" /></p>
        <h2 className="board-title"><FormattedMessage id="yours.title" /></h2>
        <p className="sub">
          {valid
            ? <FormattedMessage id="yours.subWallet" values={{ wallet: short(wallet) }} />
            : <FormattedMessage id="yours.subNone" />}
        </p>
      </header>

      {!valid && connectHref !== null && (
        <a className="btn primary yours-connect" href={connectHref} onClick={onConnect}><FormattedMessage id="yours.connect" /></a>
      )}
      {!valid && <WalletEntry typed={wallet} connect={connect} />}
      {valid && owner.isPending && <p className="state idle"><FormattedMessage id="yours.reading" /></p>}
      {valid && owner.isError && <p className="state bad"><FormattedMessage id="yours.failed" /></p>}
      {valid && owner.data && owner.data.agents.length === 0 && (
        <Empty count={0} noun={<FormattedMessage id="yours.emptyNoun" />}
               action={{ href: PATHS.fund, label: <FormattedMessage id="yours.emptyAction" /> }}>
          <p><FormattedMessage id="yours.empty" /></p>
        </Empty>
      )}
      {summary !== null && summary.runs > 0 && (
        <p className="owner-since">
          <FormattedMessage id="yours.since" values={{
            runs: summary.runs, spend: <Amount value={summary.spend} />, recorded: summary.recorded,
          }} />
        </p>
      )}
      {valid && owner.data && owner.data.agents.map((agent) => (
        <OwnerAgent key={agent.address} agent={agent} problems={exercises} ceiling={ceiling} place={placeOf(standings.data, agent.identity, agent.ranked.length > 0)}
                    gigs={gigsOf(agent.qualifies)} explorer={explorer} gym={gym} walletUrl={walletUrl}
                    seenAt={agent.current ? since : null} />
      ))}
      {valid && owner.data?.partial && <p className="state wait"><FormattedMessage id="yours.partial" /></p>}
      {valid && owner.data && owner.data.more > 0 && (
        <p className="fine"><FormattedMessage id="yours.more" values={{ count: owner.data.more }} /></p>
      )}
    </section>
  );
}

/** Opening the page by hand, with the wallet's address. */
function WalletEntry({ typed, connect }: { readonly typed: string; readonly connect: (wallet: string) => void }) {
  const [draft, setDraft] = useState(typed);
  const open = (e: FormEvent) => {
    e.preventDefault();
    connect(draft.trim());
    window.location.assign(viewHref("yours", draft.trim()));
  };
  return (
    <form className="lookup load-panel" onSubmit={open}>
      <label htmlFor="wallet"><FormattedMessage id="yours.field" /></label>
      <div className="field-row">
        <input id="wallet" value={draft} spellCheck={false} autoComplete="off" placeholder="0x…"
               onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="btn" disabled={!isWallet(draft)}><FormattedMessage id="yours.open" /></button>
      </div>
    </form>
  );
}
