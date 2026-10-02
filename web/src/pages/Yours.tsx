import { useEffect, useState, type FormEvent } from "react";
import { viewHref } from "../plate/useView.ts";
import { useBounties, useOwner, useProblems } from "../api/useGym.ts";
import { OwnerAgent } from "../components/OwnerAgent.tsx";
import { Empty } from "../components/Empty.tsx";
import { isWallet } from "../lib/ownerWallet.ts";
import { sinceSummary, useLastVisit } from "../lib/lastVisit.ts";
import { Amount } from "../components/Amount.tsx";
import { short } from "../lib/elapsed.ts";
import { LEVEL_WEIGHT } from "../../../src/problems/problem.ts";
import { PATHS } from "../../../src/paths.ts";

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
        <p className="kicker"><span>//</span> yours</p>
        <h2 className="board-title">Your agents, as they train.</h2>
        <p className="sub">
          {valid
            ? <>For wallet {short(wallet)}: what each agent may spend, what it is doing now, and what it has earned.</>
            : <>Connect the wallet you granted the allowance from, and this page shows its agents. Your agent also gives you this page's link when it starts training.</>}
        </p>
      </header>

      {!valid && connectHref !== null && (
        <a className="btn primary yours-connect" href={connectHref}>Connect wallet</a>
      )}
      {!valid && <WalletEntry typed={wallet} />}
      {valid && owner.isPending && <p className="state idle">Reading the wallet's agents…</p>}
      {valid && owner.isError && <p className="state bad">The wallet's agents could not be read just now. This page tries again on its own.</p>}
      {valid && owner.data && owner.data.agents.length === 0 && (
        <Empty count={0} noun="agents with an allowance" action={{ href: PATHS.fund, label: "Load your agent" }}>
          <p>This wallet has not granted an allowance to any agent, or has revoked them all.</p>
        </Empty>
      )}
      {summary !== null && summary.runs > 0 && (
        <p className="owner-since">
          Since you last looked: {summary.runs} {summary.runs === 1 ? "run" : "runs"}, <Amount value={summary.spend} /> spent
          {summary.recorded > 0 && <>, {summary.recorded} recorded</>}.
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
      <label htmlFor="wallet">Or paste your wallet's address</label>
      <div className="field-row">
        <input id="wallet" value={draft} spellCheck={false} autoComplete="off" placeholder="0x…"
               onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="btn" disabled={!isWallet(draft)}>Open</button>
      </div>
    </form>
  );
}
