import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import type { MessageId } from "../strings/StringsProvider.tsx";
import { useSay } from "../shared/lib/useSay.ts";
import type { BountyWire, OwnerAgentWire, ProblemWire } from "../../../src/shared/wire.ts";
import { display, format, usdc } from "../../../src/shared/money.ts";
import { PATHS } from "../../../src/shared/paths.ts";
import { PRICE } from "../../../src/shared/pricing.ts";
import { CopyLine } from "../shared/components/CopyLine.tsx";
import { viewHref } from "../shell/useView.ts";
import { Amount } from "../shared/components/Amount.tsx";
import { short, since } from "../shared/lib/elapsed.ts";
import { useNetwork } from "../shared/network/NetworkProvider.tsx";
import { outcomeOf } from "../shared/lib/outcome.ts";
import { bestByExercise } from "./best.ts";
import { nextFor } from "./next.ts";
import type { Place } from "./place.ts";

/** How many past runs a card lists. The rest are in the record, under the agent's identity. */
const RECENT_RUNS = 8;
/** How many of those a phone shows until asked for more: each is a card there, not a row. */
export const PHONE_RUNS = 3;

/** The fee to record a solve, as a person reads it. */
const RECORD_PRICE = display(PRICE.rank);

/** How much of an allowance is left, as a share of its limit from 0 to 100, for the bar. `null` where there is no limit to be a share of. */
export function shareLeft(remaining: string, limit: string): number | null {
  if (usdc(limit) === 0n) return null;
  const share = Number(usdc(remaining) * 1000n / usdc(limit)) / 10;
  return Math.min(100, Math.max(0, share));
}

export interface OwnerAgentProps {
  readonly agent: OwnerAgentWire;
  /** Every exercise the gym serves, in the order to show them. */
  readonly problems: readonly ProblemWire[];
  /** Rep's ceiling: every exercise recorded, weighted by level. */
  readonly ceiling: number;
  /** Where it stands among the others, or why that cannot be said. */
  readonly place: Place;
  /** The open gigs this agent qualifies for, in full. */
  readonly gigs: readonly BountyWire[];
  /** This gym's address, for the sentence that sends it to train. */
  readonly gym: string;
  /** When the owner last looked, so runs since then are marked new. `null` on a first look. */
  readonly seenAt: number | null;
}

/**
 * One of the owner's agents, in the order its owner asks about it: is it playing, where does it
 * stand, what has it solved, what has it cost and earned, what may it still spend, and then the
 * detail under each.
 *
 * It was a card of figures with the runs under it: all true, and none of it said whether the agent
 * was any good. Its best on each exercise and its place among the others are that answer.
 *
 * Everything about the agent comes in as props; where to look a payout up, and where the allowance
 * is changed, come from the network.
 */
export function OwnerAgent({ agent, problems, ceiling, place, gigs, gym, seenAt }: OwnerAgentProps) {
  const { explorer, walletUrl } = useNetwork();
  const a = agent.allowance;
  const live = agent.live;
  const [allRuns, setAllRuns] = useState(false);
  const [asking, setAsking] = useState(false);
  const recent = agent.runs.slice(0, RECENT_RUNS);
  const intl = useIntl();
  const say = useSay();
  const titleOf = (id: string) => problems.find((p) => p.id === id)?.title ?? id;
  const none = (id: MessageId) => <span className="none"><FormattedMessage id={id} /></span>;
  const endsOn = (seconds: number) => seconds === 0
    ? intl.formatMessage({ id: "agent.noEnd" })
    : intl.formatDate(seconds * 1000, { day: "numeric", month: "short", year: "numeric" });
  const col = {
    exercise: intl.formatMessage({ id: "rep.colExercise" }),
    level: intl.formatMessage({ id: "exercises.level" }),
    best: intl.formatMessage({ id: "agent.colBest" }),
    result: intl.formatMessage({ id: "rep.colResult" }),
    questions: intl.formatMessage({ id: "rep.colQuestions" }),
    paid: intl.formatMessage({ id: "agent.colPaid" }),
    when: intl.formatMessage({ id: "rep.colWhen" }),
  };
  const name = agent.identity !== null ? intl.formatMessage({ id: "agent.title" }, { id: agent.identity }) : short(agent.address);
  const best = bestByExercise(agent.runs);
  // Earned is what has reached the wallet. A gig won and still paying out is a win, and is said beside it.
  const paidOut = agent.won.filter((g) => g.awardTx !== null);
  const earned = format(paidOut.reduce((total, g) => total + usdc(g.amount), 0n));
  const last = agent.runs[0];
  const next = nextFor(agent, problems.map((p) => p.id));
  // Drawn for an allowance that can still be spent from. One that has ended has nothing left to show.
  const leftShare = a === null || !a.live ? null : shareLeft(a.remaining, a.limit);
  const sayId = `say-${agent.address}`;

  return (
    <article className="owner-agent" aria-label={agent.identity !== null ? name : agent.address}>
      <header className="owner-agent-head">
        <div>
          <h3>{name}</h3>
          <span className="proof"><FormattedMessage id="agent.paysFrom" values={{ address: short(agent.address) }} /></span>
        </div>
        {agent.current && (
          <button type="button" className="btn primary" aria-expanded={asking} aria-controls={sayId}
                  onClick={() => setAsking((open) => !open)}>
            <FormattedMessage id="agent.trainAgain" />
          </button>
        )}
      </header>

      {/* Training is one sentence said to the agent, so sending it again is that sentence, here to copy. */}
      {agent.current && asking && (
        <div className="say-again" id={sayId}>
          <p><FormattedMessage id="agent.sayThis" /></p>
          <CopyLine text={intl.formatMessage({ id: "step4.sentence" }, { gym })} label="copy.sentence" />
        </div>
      )}

      {!agent.current ? (
        <p className="owner-live"><FormattedMessage id="agent.noAllowanceNote" /></p>
      ) : live !== null ? (
        <p className="owner-live on" aria-live="polite">
          <span className="blink" />
          <FormattedMessage id="agent.playing" values={{
            exercise: titleOf(live.problem), count: live.probes, spend: <Amount value={live.spend} />,
          }} />
        </p>
      ) : (
        <p className="owner-live">
          {last === undefined
            ? <FormattedMessage id="agent.idle" />
            : <FormattedMessage id="agent.resting" values={{ exercise: titleOf(last.problem), when: say(since(last.startedAt)) }} />}
        </p>
      )}

      <dl className="tiles">
        <div className={place.kind === "placed" ? "tile lead" : "tile"}>
          <dt><FormattedMessage id="agent.stands" /></dt>
          <dd>
            {place.kind === "placed" ? (
              <a href={viewHref("standings")} className="tile-figure">
                <FormattedMessage id="agent.place" values={{ place: place.place, of: place.of }} />
              </a>
            ) : (
              <span className="tile-figure none">
                {place.kind === "past" ? <FormattedMessage id="agent.placePast" values={{ listed: place.listed }} />
                  // The standings not read, or its rep not read: either way where it stands is not known.
                  : place.kind === "unread" || agent.repUnread ? <FormattedMessage id="agent.unread" />
                  : <FormattedMessage id="agent.notOnTable" />}
              </span>
            )}
            {/* Unread rep is not said twice, and is not none. */}
            {!agent.repUnread && (
              <span className="tile-note">
                <FormattedMessage id="agent.rep" />{" "}
                {agent.rep === null ? none("agent.noneYet")
                  // Until the gym's exercises are known there is no ceiling to set it against.
                  : ceiling === 0 ? agent.rep
                  : <FormattedMessage id="agent.repValue" values={{ rep: agent.rep, ceiling }} />}
              </span>
            )}
          </dd>
        </div>
        <div className="tile">
          <dt><FormattedMessage id="agent.solved" /></dt>
          <dd>
            {/* What it has recorded is read from the registry with its rep. Unread, it is not "0 of 7". */}
            {agent.repUnread ? <span className="tile-figure none"><FormattedMessage id="agent.unread" /></span> : <>
              <span className="tile-figure">
                {problems.length === 0 ? agent.ranked.length
                  : <FormattedMessage id="agent.solvedValue" values={{ count: agent.ranked.length, total: problems.length }} />}
              </span>
              {(place.kind === "placed" || place.kind === "absent") && (
                <span className="tile-note">
                  <FormattedMessage id="agent.holds" values={{ count: place.kind === "placed" ? place.holds : 0 }} />
                </span>
              )}
            </>}
          </dd>
        </div>
        <div className="tile">
          <dt><FormattedMessage id="agent.spent" /></dt>
          <dd>
            <span className="tile-figure"><Amount value={agent.spend} /></span>
            <span className="tile-note"><FormattedMessage id="agent.overRuns" values={{ count: agent.runs.length }} /></span>
          </dd>
        </div>
        <div className="tile">
          <dt><FormattedMessage id="agent.earned" /></dt>
          <dd>
            <span className="tile-figure"><Amount value={earned} /></span>
            <span className="tile-note">
              <FormattedMessage id="agent.gigsWon" values={{ count: paidOut.length }} />
              {agent.won.length > paidOut.length && <>
                {" "}<FormattedMessage id="agent.gigsPending" values={{ count: agent.won.length - paidOut.length }} />
              </>}
            </span>
          </dd>
        </div>
      </dl>

      <dl className="allowance-line">
        <dt><FormattedMessage id="agent.allowance" /></dt>
        {!agent.current ? <dd>{none("agent.noAllowance")}</dd>
          : a === null ? <dd>{none("agent.unread")}</dd>
          : <>
            <dd>
              <FormattedMessage id="agent.leftOf" values={{ left: <Amount value={a.remaining} />, limit: <Amount value={a.limit} /> }} />
              {", "}
              {a.live ? <FormattedMessage id="agent.until" values={{ date: endsOn(a.validUntil) }} /> : none("agent.endedOrUsed")}
            </dd>
            {leftShare !== null && (
              <dd className="allowance-bar" aria-hidden="true"><span style={{ width: `${leftShare}%` }} /></dd>
            )}
          </>}
        {walletUrl !== null && (
          <dd><a href={walletUrl} target="_blank" rel="noreferrer"><FormattedMessage id="agent.inWallet" /></a></dd>
        )}
      </dl>

      <div className="agent-cols">
        <section aria-label={intl.formatMessage({ id: "agent.bestTitle" })}>
          <h4 className="give-label"><FormattedMessage id="agent.bestTitle" /></h4>
          <table className="ledger best-table">
            <thead>
              <tr><th>{col.exercise}</th><th>{col.level}</th><th className="num">{col.best}</th><th className="num">{col.questions}</th></tr>
            </thead>
            <tbody>
              {problems.map((p) => {
                const mine = best.get(p.id);
                // The registry is what says an exercise is recorded, as it is what rep is counted from. Where it
                // could not be read, a run this gym knows it recorded says so too.
                const recorded = agent.ranked.includes(p.id) || mine?.recorded === true;
                return (
                  <tr key={p.id} className={mine === undefined ? "unsolved" : undefined}>
                    <td>
                      <a href={viewHref("exercises", p.id)}>{p.title}</a>
                      {recorded && <span className="mark"><FormattedMessage id="leaderboard.recorded" /></span>}
                    </td>
                    <td className="dim" data-label={col.level}><span className="level-word"><FormattedMessage id={`level.${p.level}`} /></span></td>
                    <td className="num" data-label={col.best}>
                      {/* Recorded, with no solve of it among the runs this gym has: its cost is not known here, and it is not unsolved. */}
                      {mine !== undefined ? <Amount value={mine.run.spend} /> : recorded ? "" : none("agent.notSolved")}
                    </td>
                    <td className="num" data-label={col.questions}>{mine === undefined ? "" : mine.run.probes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section aria-label={intl.formatMessage({ id: "agent.runsTitle" })}>
          <h4 className="give-label"><FormattedMessage id="agent.runsTitle" /></h4>
          {agent.runs.length === 0 ? <p className="fine"><FormattedMessage id="agent.noRuns" /></p> : (
            <table className="ledger owner-runs" id={`runs-${agent.address}`}>
              <thead>
                <tr>
                  <th>{col.exercise}</th><th>{col.result}</th>
                  <th className="num">{col.questions}</th><th className="num">{col.paid}</th><th className="num">{col.when}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => {
                  const o = outcomeOf(r);
                  return (
                    // Past the third, hidden on a phone until asked for: see `.owner-runs tr.extra`.
                    <tr key={r.attempt} className={!allRuns && i >= PHONE_RUNS ? "extra" : undefined}>
                      <td>
                        {titleOf(r.problem)}
                        {seenAt !== null && r.startedAt > seenAt && <span className="new-tag"><FormattedMessage id="agent.new" /></span>}
                      </td>
                      <td className={o.tone}>{say(o.label)}</td>
                      <td className="num" data-label={col.questions}>{r.probes}</td>
                      {/* What the owner paid for it, the record's fee included, so the rows add up to the total above. */}
                      <td className="num" data-label={col.paid}><Amount value={r.paid} /></td>
                      <td className="num dim" data-label={col.when}>{say(since(r.startedAt))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {/*
            * Drawn only on a phone. It stays where it is and turns into the way back, so the person who
            * pressed it, by key or by touch, is not left with nothing under their finger.
            */}
          {recent.length > PHONE_RUNS && (
            <button type="button" className="see-all" aria-expanded={allRuns} aria-controls={`runs-${agent.address}`}
                    onClick={() => setAllRuns((all) => !all)}>
              {allRuns
                ? <FormattedMessage id="agent.fewerRuns" />
                : <FormattedMessage id="agent.moreRuns" values={{ count: recent.length - PHONE_RUNS }} />}
            </button>
          )}

          {/* The same run costs less on the standings, where the fee for recording is no part of the score. */}
          {agent.runs.some((r) => r.ranked) && (
            <p className="fine"><FormattedMessage id="agent.paidNote" values={{ price: RECORD_PRICE }} /></p>
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

          {next.kind !== "nothing" && (
            <div className="owner-next">
              <p className="give-label"><FormattedMessage id="agent.next" /></p>
              <p>
                {next.kind === "start" && <FormattedMessage id="agent.nextStart" values={{ link: (chunks) => <a href={PATHS.fund}>{chunks}</a> }} />}
                {next.kind === "record" && <FormattedMessage id="agent.nextRecord" />}
                {next.kind === "more" && <FormattedMessage id="agent.nextMore" values={{ list: intl.formatList(next.left.map(titleOf)) }} />}
                {next.kind === "all" && <FormattedMessage id="agent.nextAll" values={{ link: (chunks) => <a href={viewHref("gigs")}>{chunks}</a> }} />}
              </p>
            </div>
          )}
        </section>
      </div>
    </article>
  );
}
