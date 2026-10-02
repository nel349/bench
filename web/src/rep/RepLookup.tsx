import { FormattedMessage, useIntl } from "react-intl";
import { PRICE } from "../../../src/shared/pricing.ts";
import { display } from "../../../src/shared/money.ts";
import { useEffect, useState, type FormEvent } from "react";
import { viewHref } from "../shell/useView.ts";
import { useAgentRecord, useChainRating, useProblems } from "../shared/api/useGym.ts";
import { ApiError } from "../shared/api/client.ts";
import { whoIs } from "./who.ts";
import { short } from "../shared/lib/elapsed.ts";
import { Amount } from "../shared/components/Amount.tsx";
import { LEVEL_WEIGHT } from "../../../src/problems/problem.ts";

export interface RepLookupProps {
  /** Who the address bar says is being looked up: the part of `#ledger/…` after the view. */
  readonly looking: string;
  /** The reputation registry, so a reader can check the number without us. `null` where there is none. */
  readonly registry: string | null;
  readonly explorer: string;
}

/**
 * Anyone's rep, looked up the way a gig's poster would.
 *
 * An ERC-8004 id gets the number the bounty gate reads: from the registry, counting only the entries
 * the gym's scribe wrote, with enough said to check it there without trusting this page. An address
 * gets the runs it paid for, which is our own record rather than the credential. The lookup lives in
 * the URL, so a result can be linked to.
 */
export function RepLookup({ looking, registry, explorer }: RepLookupProps) {
  const [draft, setDraft] = useState(looking);
  useEffect(() => setDraft(looking), [looking]);

  const who = whoIs(looking);
  const problems = useProblems();
  const rating = useChainRating(who.kind === "identity" ? who.id : null);
  const record = useAgentRecord(who.kind === "address" ? who.address : null);
  const ceiling = (problems.data ?? []).reduce((t, p) => t + LEVEL_WEIGHT[p.level], 0);
  const titleOf = (id: string) => problems.data?.find((p) => p.id === id)?.title ?? id;
  const levelOf = (id: string) => problems.data?.find((p) => p.id === id)?.level;

  const intl = useIntl();
  const look = (e: FormEvent) => {
    e.preventDefault();
    window.location.assign(viewHref("ledger", draft.trim()));
  };

  return (
    <section className="rep-lookup load-panel" aria-label={intl.formatMessage({ id: "lookup.label" })}>
      <form className="lookup" onSubmit={look}>
        <label htmlFor="who"><FormattedMessage id="lookup.field" /></label>
        <div className="field-row">
          <input id="who" value={draft} onChange={(e) => setDraft(e.target.value)}
                 placeholder={intl.formatMessage({ id: "lookup.placeholder" })} spellCheck={false} autoComplete="off" />
          <button className="btn" type="submit" disabled={whoIs(draft).kind === "neither"}>
            <FormattedMessage id="lookup.submit" />
          </button>
        </div>
      </form>

      {looking !== "" && who.kind === "neither" && (
        <p className="state bad"><FormattedMessage id="lookup.neither" /></p>
      )}

      {who.kind === "identity" && rating.isError && (
        <p className="state bad">
          {rating.error instanceof ApiError && rating.error.status === 404
            ? <FormattedMessage id="lookup.noRegistry" />
            : <FormattedMessage id="lookup.registryDown" />}
        </p>
      )}
      {who.kind === "identity" && rating.data && (
        <div className="rep-result">
          <p className="rep-figure"><span className="rep-n">{rating.data.rating}</span>
            <span className="rep-of"><FormattedMessage id="lookup.of" values={{ ceiling }} /></span></p>
          {rating.data.ranked.length === 0 ? (
            <p className="state idle">
              <FormattedMessage id="lookup.none" values={{ id: rating.data.agent, price: display(PRICE.rank) }} />
            </p>
          ) : (
            <ul className="rep-ranked">
              {rating.data.ranked.map((id) => {
                const level = levelOf(id);
                return <li key={id}><span>{titleOf(id)}</span>{level && <b>+{LEVEL_WEIGHT[level]}</b>}</li>;
              })}
            </ul>
          )}
          {/* For the builder who wants to check it without trusting this page; folded, so it is not the headline. */}
          <details className="fine check">
            <summary><FormattedMessage id="lookup.check" /></summary>
            <p>
              <FormattedMessage id="lookup.checkScribe" values={{
                id: rating.data.agent,
                scribe: <a href={`${explorer}/address/${rating.data.scribe}`}>{short(rating.data.scribe)}</a>,
              }} />
              {registry && <>
                {" "}<FormattedMessage id="lookup.checkRegistry" values={{
                  registry: <a href={`${explorer}/address/${registry}`}>{short(registry)}</a>,
                }} />
              </>}
            </p>
          </details>
        </div>
      )}

      {who.kind === "address" && record.data && (
        <div className="rep-result">
          {record.data.attempts === 0 ? (
            <p className="state idle"><FormattedMessage id="lookup.noRuns" values={{ address: short(who.address) }} /></p>
          ) : (
            <dl className="balances">
              <div className="balance"><dt><FormattedMessage id="lookup.runsPaid" /></dt><dd>{record.data.attempts}</dd></div>
              <div className="balance"><dt><FormattedMessage id="lookup.solved" /></dt><dd>{record.data.solved}</dd></div>
              <div className="balance"><dt><FormattedMessage id="lookup.ranOut" /></dt><dd>{record.data.refused}</dd></div>
              <div className="balance"><dt><FormattedMessage id="lookup.spent" /></dt><dd><Amount value={record.data.spend} /></dd></div>
            </dl>
          )}
          <p className="fine"><FormattedMessage id="lookup.addressNote" /></p>
        </div>
      )}
    </section>
  );
}
