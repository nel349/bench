import type { BountyWire, OwnerAgentWire } from "../../../src/wire.ts";
import { viewHref } from "../plate/useView.ts";
import { Amount } from "./Amount.tsx";
import { short, since } from "../lib/elapsed.ts";
import { outcomeOf } from "../lib/outcome.ts";

/** How many past runs a card lists. The rest are in the record, under the agent's identity. */
const RECENT_RUNS = 8;

export interface OwnerAgentProps {
  readonly agent: OwnerAgentWire;
  /** Rep's ceiling: every problem ranked, weighted by level. */
  readonly ceiling: number;
  readonly titleOf: (problem: string) => string;
  /** The open gigs this agent qualifies for, in full. */
  readonly gigs: readonly BountyWire[];
  /** Where a payout transaction can be looked up. */
  readonly explorer: string;
  /** When the owner last looked, so runs since then are marked new. `null` on a first look. */
  readonly seenAt: number | null;
}

const endsOn = (seconds: number): string =>
  seconds === 0 ? "no end date"
  : new Date(seconds * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * One of the owner's agents: what it may spend, what it is doing now, what it earned, what it may
 * enter, and what it did. Presentational; everything comes in as props.
 */
export function OwnerAgent({ agent, ceiling, titleOf, gigs, explorer, seenAt }: OwnerAgentProps) {
  const a = agent.allowance;
  const live = agent.live;
  return (
    <article className="owner-agent" aria-label={agent.identity !== null ? `Agent #${agent.identity}` : agent.address}>
      <header className="owner-agent-head">
        <h3>{agent.identity !== null ? <>Agent #{agent.identity}</> : short(agent.address)}</h3>
        <span className="proof">pays from {short(agent.address)}</span>
      </header>

      <dl className="ex-stats owner-stats">
        <div><dt>Rep</dt><dd>{agent.rep === null ? <span className="none">none yet</span> : <>{agent.rep} / {ceiling}</>}</dd></div>
        {agent.current ? (
          <>
            <div><dt>Left to spend</dt><dd>{a === null ? <span className="none">unread</span> : <><Amount value={a.remaining} /> <span className="of">of <Amount value={a.limit} /></span></>}</dd></div>
            <div><dt>Allowance ends</dt><dd>{a === null ? <span className="none">unread</span> : a.live ? endsOn(a.validUntil) : <span className="none">ended or used up</span>}</dd></div>
          </>
        ) : (
          <div className="owner-revoked"><dt>Allowance</dt><dd><span className="none">revoked</span></dd></div>
        )}
        <div><dt>Spent here</dt><dd><Amount value={agent.spend} /></dd></div>
      </dl>

      {!agent.current && (
        <p className="owner-live">This wallet no longer grants it an allowance, so it cannot spend. Its record stays: grant it again in your wallet to train it more.</p>
      )}

      {agent.current && (live !== null ? (
        <p className="owner-live on" aria-live="polite">
          <span className="blink" />Playing {titleOf(live.problem)} now: {live.probes} {live.probes === 1 ? "question" : "questions"}, <Amount value={live.spend} /> so far
        </p>
      ) : (
        <p className="owner-live">Not playing right now. Its runs appear here as they happen.</p>
      ))}

      {agent.ranked.length > 0 && (
        <p className="owner-ranked">Ranked: {agent.ranked.map(titleOf).join(", ")}</p>
      )}

      {agent.won.length > 0 && (
        <div className="owner-gigs">
          <p className="give-label">Won</p>
          <ul>
            {agent.won.map((g) => (
              <li key={g.id}>{g.title} <Amount value={g.amount} />{" "}
                <span className="dim">{g.awardTx ? <a href={`${explorer}/tx/${g.awardTx}`}>paid on chain</a> : "paying out"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {gigs.length > 0 && (
        <div className="owner-gigs">
          <p className="give-label">Qualifies for</p>
          <ul>
            {gigs.map((g) => (
              <li key={g.id}><a href={viewHref("gigs")}>{g.title}</a> <Amount value={g.amount} /></li>
            ))}
          </ul>
          <p className="fine">To enter one, tell your agent which gig to take on Bench. It needs nothing else: its rep is what lets it in.</p>
        </div>
      )}

      {agent.runs.length > 0 && (
        <table className="ledger owner-runs">
          <thead>
            <tr><th>Exercise</th><th>Result</th><th className="num">Probes</th><th className="num">Cost</th><th className="num">When</th></tr>
          </thead>
          <tbody>
            {agent.runs.slice(0, RECENT_RUNS).map((r) => {
              const o = outcomeOf(r);
              return (
                <tr key={r.attempt}>
                  <td>{titleOf(r.problem)}{seenAt !== null && r.startedAt > seenAt && <span className="new-tag">new</span>}</td>
                  <td className={o.tone}>{o.label}</td>
                  <td className="num" data-label="Probes">{r.probes}</td>
                  <td className="num" data-label="Cost"><Amount value={r.spend} /></td>
                  <td className="num dim" data-label="When">{since(r.startedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </article>
  );
}
