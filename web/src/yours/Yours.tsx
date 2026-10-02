import { FormattedMessage } from "react-intl";
import { useEffect, useState, type FormEvent } from "react";
import { viewHref } from "../shell/useView.ts";
import { useBounties, useOwner, useProblems } from "../shared/api/useGym.ts";
import { OwnerAgent } from "./OwnerAgent.tsx";
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
  /** Called with a wallet once it is shown, so this browser offers it again. */
  readonly remember: (wallet: string) => void;
  /** Where Connect wallet goes, or `null` where no wallet serves this network. */
  readonly connectHref: string | null;
  /** Where a transaction can be looked up. */
  readonly explorer: string;
}

/**
 * The owner's own page: their wallet's agents, what each is doing now, spent and earned.
 *
 * Reached by the link an agent gives when it starts training, or the wallet's own link, and kept
 * in the URL so it can be bookmarked. Everything on it is public, so it asks for nothing but the
 * wallet's address.
 */
export function Yours({ wallet, remember, connectHref, explorer }: YoursProps) {
  const valid = isWallet(wallet);
  const owner = useOwner(valid ? wallet : null);
  const problems = useProblems();
  const bounties = useBounties();
  useEffect(() => { if (valid && owner.data) remember(wallet); }, [valid, owner.data, wallet, remember]);

  const since = useLastVisit(valid ? wallet : null);
  const summary = since !== null && owner.data ? sinceSummary(owner.data.agents.flatMap((a) => a.runs), since) : null;
  const ceiling = (problems.data ?? []).reduce((t, p) => t + LEVEL_WEIGHT[p.level], 0);
  const titleOf = (id: string) => problems.data?.find((p) => p.id === id)?.title ?? id;
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
        <a className="btn primary yours-connect" href={connectHref}><FormattedMessage id="yours.connect" /></a>
      )}
      {!valid && <WalletEntry typed={wallet} />}
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
        <OwnerAgent key={agent.address} agent={agent} ceiling={ceiling} titleOf={titleOf}
                    gigs={gigsOf(agent.qualifies)} explorer={explorer} seenAt={since} />
      ))}
    </section>
  );
}

/** Opening the page by hand, with the wallet's address. */
function WalletEntry({ typed }: { readonly typed: string }) {
  const [draft, setDraft] = useState(typed);
  const open = (e: FormEvent) => {
    e.preventDefault();
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
