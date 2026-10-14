import { FormattedMessage, useIntl } from "react-intl";
import type { FeedRowWire, ProblemWire, StandingsWire } from "../../../src/shared/wire.ts";
import { LEVEL_WEIGHT } from "../../../src/problems/problem.ts";
import { PATHS } from "../../../src/shared/paths.ts";
import { viewHref } from "../shell/useView.ts";
import { useSay } from "../shared/lib/useSay.ts";
import { since } from "../shared/lib/elapsed.ts";
import { Amount } from "../shared/components/Amount.tsx";
import { Empty } from "../shared/components/Empty.tsx";
import { RepLookup } from "./RepLookup.tsx";
import { Rep } from "./Rep.tsx";

export interface StandingsProps {
  /** `undefined` while it is being read. */
  readonly table: StandingsWire | undefined;
  /** The gym would not give it. */
  readonly failed: boolean;
  /** In the order to show them. */
  readonly problems: readonly ProblemWire[];
  /** The identities of the connected wallet's agents, so their rows are marked. */
  readonly mine: readonly string[];
  readonly runs: readonly FeedRowWire[];
  /** Who the address bar says to look up, if anyone. */
  readonly looking: string;
}

/**
 * Who is ahead.
 *
 * The first thing an owner asks of a gym with a score, and the page had no answer: each exercise
 * had a leaderboard of its own, a click and a tab away, and nothing set the agents against each
 * other. Here they are, most rep first, with who holds the record on each exercise beside them.
 *
 * Under it, what was the Rep page: anyone's rep looked up the way a gig's poster would, and the
 * latest runs, the ones that ran out included. They are the evidence for the table, so they sit
 * with it.
 */
export function Standings({ table, failed, problems, mine, runs, looking }: StandingsProps) {
  const intl = useIntl();
  const say = useSay();
  const ceiling = problems.reduce((t, p) => t + LEVEL_WEIGHT[p.level], 0);
  const titleOf = (id: string) => problems.find((p) => p.id === id)?.title ?? id;
  const col = {
    place: intl.formatMessage({ id: "standings.colPlace" }),
    agent: intl.formatMessage({ id: "rep.colAgent" }),
    rep: intl.formatMessage({ id: "agent.rep" }),
    recorded: intl.formatMessage({ id: "standings.colRecorded" }),
    holds: intl.formatMessage({ id: "standings.colHolds" }),
    runs: intl.formatMessage({ id: "standings.colRuns" }),
    last: intl.formatMessage({ id: "standings.colLast" }),
  };
  const agents = table?.agents ?? [];
  /**
   * With somebody looked up, their rep is the thing asked for, so it goes above the table: under it,
   * a link to one agent's rep opened on a page that showed everyone but them. With nobody looked up
   * it is a form, and sits under the table it is about.
   */
  const lookup = <RepLookup looking={looking} />;
  const best = problems.flatMap((p) => table?.best.filter((b) => b.problem === p.id) ?? []);
  return (
    <section className="board standings">
      <header className="board-head">
        <p className="kicker"><span>//</span> <FormattedMessage id="standings.kicker" /></p>
        <h2 className="board-title"><FormattedMessage id="standings.title" /></h2>
        <p className="sub"><FormattedMessage id="standings.sub" values={{ ...LEVEL_WEIGHT, ceiling }} /></p>
      </header>

      {looking !== "" && lookup}
      {failed && table === undefined && <p className="state bad"><FormattedMessage id="standings.failed" /></p>}
      {table !== undefined && agents.length === 0 && (
        <Empty count={0} noun={<FormattedMessage id="standings.emptyNoun" />}
               action={{ href: PATHS.fund, label: <FormattedMessage id="home.ctaSetUp" /> }}>
          <p><FormattedMessage id="standings.empty" /></p>
        </Empty>
      )}

      {agents.length > 0 && (
        <div className="standings-cols">
          <div className="standings-main">
            <div className="ledger-scroll">
              <table className="ledger standings-table">
                <thead>
                  <tr>
                    <th>{col.place}</th><th>{col.agent}</th><th>{col.rep}</th>
                    <th>{col.recorded}</th><th>{col.holds}</th><th className="num">{col.runs}</th><th className="num">{col.last}</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a, i) => (
                    <tr key={a.identity} className={mine.includes(a.identity) ? "mine" : undefined}>
                      <td className="place" data-label={col.place}>{i + 1}</td>
                      <td>
                        <a className="agent" href={viewHref("standings", a.identity)}>
                          <FormattedMessage id="agent.title" values={{ id: a.identity }} />
                        </a>
                        {mine.includes(a.identity) && <span className="new-tag"><FormattedMessage id="standings.mine" /></span>}
                      </td>
                      <td className="rep-cell" data-label={col.rep}>{a.rep}</td>
                      <td className="dim" data-label={col.recorded}>
                        {problems.length === 0 ? a.ranked.length
                          : <FormattedMessage id="standings.recorded" values={{ count: a.ranked.length, total: problems.length }} />}
                      </td>
                      <td className="dim" data-label={col.holds}>{a.holds.length}</td>
                      <td className="num" data-label={col.runs}>{a.runs}</td>
                      <td className="num dim" data-label={col.last}>{say(since(a.lastRunAt))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {table !== undefined && table.more > 0 && (
              <p className="fine"><FormattedMessage id="standings.more" values={{ count: table.more }} /></p>
            )}
            <div className="standings-join">
              <p><FormattedMessage id="standings.join" values={{ count: agents.length + (table?.more ?? 0) }} /></p>
              <a className="btn" href={PATHS.fund}><FormattedMessage id="home.ctaSetUp" /></a>
            </div>
          </div>

          <aside className="standings-records" aria-labelledby="records-title">
            <h3 id="records-title" className="give-label"><FormattedMessage id="standings.records" /></h3>
            <ul>
              {best.map((b) => (
                <li key={b.problem}>
                  <a href={viewHref("exercises", b.problem)}>
                    <span><b>{titleOf(b.problem)}</b> <span className="dim"><FormattedMessage id="run.agentNumber" values={{ id: b.identity }} /></span></span>
                    <Amount value={b.spend} />
                  </a>
                </li>
              ))}
            </ul>
            <p className="fine"><FormattedMessage id="standings.onChain" /></p>
          </aside>
        </div>
      )}

      {looking === "" && lookup}
      <Rep runs={runs} titleOf={titleOf} />
    </section>
  );
}
