import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import type { MessageId } from "../strings/StringsProvider.tsx";
import { useSay } from "../shared/lib/useSay.ts";
import type { BountyWire, OwnerAgentWire } from "../../../src/shared/wire.ts";
import { viewHref } from "../shell/useView.ts";
import { Amount } from "../shared/components/Amount.tsx";
import { short, since } from "../shared/lib/elapsed.ts";
import { outcomeOf } from "../shared/lib/outcome.ts";

/** How many past runs a card lists. The rest are in the record, under the agent's identity. */
const RECENT_RUNS = 8;
/** How many of those a phone shows before See all runs: each is a card there, not a row. */
export const PHONE_RUNS = 3;

export interface OwnerAgentProps {
  readonly agent: OwnerAgentWire;
  /** Rep's ceiling: every exercise recorded, weighted by level. */
  readonly ceiling: number;
  readonly titleOf: (problem: string) => string;
  /** The open gigs this agent qualifies for, in full. */
  readonly gigs: readonly BountyWire[];
  /** Where a payout transaction can be looked up. */
  readonly explorer: string;
  /** When the owner last looked, so runs since then are marked new. `null` on a first look. */
  readonly seenAt: number | null;
}

/**
 * One of the owner's agents: what it may spend, what it is doing now, what it earned, what it may
 * enter, and what it did. Presentational; everything comes in as props.
 */
export function OwnerAgent({ agent, ceiling, titleOf, gigs, explorer, seenAt }: OwnerAgentProps) {
  const a = agent.allowance;
  const live = agent.live;
  const [allRuns, setAllRuns] = useState(false);
  const recent = agent.runs.slice(0, RECENT_RUNS);
  const intl = useIntl();
  const say = useSay();
  const none = (id: MessageId) => <span className="none"><FormattedMessage id={id} /></span>;
  const endsOn = (seconds: number) => seconds === 0
    ? intl.formatMessage({ id: "agent.noEnd" })
    : intl.formatDate(seconds * 1000, { day: "numeric", month: "short", year: "numeric" });
  const col = {
    exercise: intl.formatMessage({ id: "rep.colExercise" }),
    result: intl.formatMessage({ id: "rep.colResult" }),
    questions: intl.formatMessage({ id: "rep.colQuestions" }),
    cost: intl.formatMessage({ id: "rep.colCost" }),
    when: intl.formatMessage({ id: "rep.colWhen" }),
  };
  const name = agent.identity !== null ? intl.formatMessage({ id: "agent.title" }, { id: agent.identity }) : short(agent.address);
  return (
    <article className="owner-agent" aria-label={agent.identity !== null ? name : agent.address}>
      <header className="owner-agent-head">
        <h3>{name}</h3>
        <span className="proof"><FormattedMessage id="agent.paysFrom" values={{ address: short(agent.address) }} /></span>
      </header>

      <dl className="ex-stats owner-stats">
        <div>
          <dt><FormattedMessage id="agent.rep" /></dt>
          <dd>{agent.rep === null ? none("agent.noneYet") : <FormattedMessage id="agent.repValue" values={{ rep: agent.rep, ceiling }} />}</dd>
        </div>
        {agent.current ? (
          <>
            <div>
              <dt><FormattedMessage id="agent.left" /></dt>
              <dd>
                {a === null ? none("agent.unread") : <>
                  <Amount value={a.remaining} />{" "}
                  <span className="of"><FormattedMessage id="agent.of" values={{ limit: <Amount value={a.limit} /> }} /></span>
                </>}
              </dd>
            </div>
            <div>
              <dt><FormattedMessage id="agent.ends" /></dt>
              <dd>{a === null ? none("agent.unread") : a.live ? endsOn(a.validUntil) : none("agent.endedOrUsed")}</dd>
            </div>
          </>
        ) : (
          <div className="owner-revoked"><dt><FormattedMessage id="agent.allowance" /></dt><dd>{none("agent.revoked")}</dd></div>
        )}
        <div><dt><FormattedMessage id="agent.spent" /></dt><dd><Amount value={agent.spend} /></dd></div>
      </dl>

      {!agent.current && (
        <p className="owner-live"><FormattedMessage id="agent.revokedNote" /></p>
      )}

      {agent.current && (live !== null ? (
        <p className="owner-live on" aria-live="polite">
          <span className="blink" />
          <FormattedMessage id="agent.playing" values={{
            exercise: titleOf(live.problem), count: live.probes, spend: <Amount value={live.spend} />,
          }} />
        </p>
      ) : (
        <p className="owner-live"><FormattedMessage id="agent.idle" /></p>
      ))}

      {agent.ranked.length > 0 && (
        <p className="owner-ranked">
          <FormattedMessage id="agent.recorded" values={{ list: intl.formatList(agent.ranked.map(titleOf)) }} />
        </p>
      )}

      {agent.won.length > 0 && (
        <div className="owner-gigs">
          <p className="give-label"><FormattedMessage id="agent.won" /></p>
          <ul>
            {agent.won.map((g) => (
              <li key={g.id}>{g.title} <Amount value={g.amount} />{" "}
                <span className="dim">
                  {g.awardTx
                    ? <a href={`${explorer}/tx/${g.awardTx}`}><FormattedMessage id="gigs.paidOnChain" /></a>
                    : <FormattedMessage id="gigs.payingOut" />}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {gigs.length > 0 && (
        <div className="owner-gigs">
          <p className="give-label"><FormattedMessage id="agent.qualifies" /></p>
          <ul>
            {gigs.map((g) => (
              <li key={g.id}><a href={viewHref("gigs")}>{g.title}</a> <Amount value={g.amount} /></li>
            ))}
          </ul>
          <p className="fine"><FormattedMessage id="agent.enter" /></p>
        </div>
      )}

      {agent.runs.length > 0 && (
        <table className={allRuns ? "ledger owner-runs" : "ledger owner-runs short"}>
          <thead>
            <tr>
              <th>{col.exercise}</th><th>{col.result}</th>
              <th className="num">{col.questions}</th><th className="num">{col.cost}</th><th className="num">{col.when}</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => {
              const o = outcomeOf(r);
              return (
                <tr key={r.attempt}>
                  <td>
                    {titleOf(r.problem)}
                    {seenAt !== null && r.startedAt > seenAt && <span className="new-tag"><FormattedMessage id="agent.new" /></span>}
                  </td>
                  <td className={o.tone}>{say(o.label)}</td>
                  <td className="num" data-label={col.questions}>{r.probes}</td>
                  <td className="num" data-label={col.cost}><Amount value={r.spend} /></td>
                  <td className="num dim" data-label={col.when}>{say(since(r.startedAt))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {/* Drawn only on a phone, where the list stops at three: see `.owner-runs.short`. */}
      {!allRuns && recent.length > PHONE_RUNS && (
        <button type="button" className="see-all" onClick={() => setAllRuns(true)}>
          <FormattedMessage id="agent.seeAllRuns" values={{ count: recent.length }} />
        </button>
      )}
    </article>
  );
}
