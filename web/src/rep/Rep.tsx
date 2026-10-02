import { FormattedMessage, useIntl } from "react-intl";
import { useSay } from "../shared/lib/useSay.ts";
import type { FeedRowWire } from "../../../src/shared/wire.ts";
import { Amount } from "../shared/components/Amount.tsx";
import { short, since } from "../shared/lib/elapsed.ts";
import { Empty } from "../shared/components/Empty.tsx";
import { RepLookup } from "./RepLookup.tsx";
import { outcomeOf } from "../shared/lib/outcome.ts";
import { runnerName } from "../shared/lib/runner.ts";
import { PATHS } from "../../../src/shared/paths.ts";

export interface RepProps {
  readonly runs: readonly FeedRowWire[];
  /** An exercise's name, from its id, as the rest of the page names it. */
  readonly titleOf: (problem: string) => string;
  /** Who the address bar says to look up, if anyone. */
  readonly looking: string;
  readonly registry: string | null;
  readonly explorer: string;
}

/**
 * Rep being earned, run by run, the ones that ran out included.
 *
 * `paid by` sits under the agent's name rather than replacing it: the name is what an agent calls
 * itself, the address is what its money proves, and a record that showed only the name would be
 * reporting a header as though it were a fact.
 */
export function Rep({ runs, titleOf, looking, registry, explorer }: RepProps) {
  const say = useSay();
  const intl = useIntl();
  const col = {
    agent: intl.formatMessage({ id: "rep.colAgent" }),
    exercise: intl.formatMessage({ id: "rep.colExercise" }),
    result: intl.formatMessage({ id: "rep.colResult" }),
    questions: intl.formatMessage({ id: "rep.colQuestions" }),
    cost: intl.formatMessage({ id: "rep.colCost" }),
    when: intl.formatMessage({ id: "rep.colWhen" }),
  };
  return (
    <section className="board">
      <header className="board-head">
        <p className="kicker"><span>02</span> <FormattedMessage id="rep.kicker" /></p>
        <h2 className="board-title"><FormattedMessage id="rep.title" /></h2>
        <p className="sub"><FormattedMessage id="rep.sub" /></p>
      </header>

      <RepLookup looking={looking} registry={registry} explorer={explorer} />

      {runs.length === 0 ? (
        <Empty count={0} noun={<FormattedMessage id="rep.emptyNoun" />}
               action={{ href: PATHS.fund, label: <FormattedMessage id="rep.emptyAction" /> }}>
          <p><FormattedMessage id="rep.empty1" /></p>
          <p><FormattedMessage id="rep.empty2" /></p>
        </Empty>
      ) : (
        <div className="ledger-scroll">
          <table className="ledger">
            <thead>
              <tr>
                <th>{col.agent}</th><th>{col.exercise}</th><th>{col.result}</th>
                <th className="num">{col.questions}</th><th className="num">{col.cost}</th><th className="num">{col.when}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const o = outcomeOf(r);
                return (
                  <tr key={r.attempt}>
                    <td>
                      <span className="agent">{say(runnerName(r))}</span>
                      {r.payer && <span className="proof"><FormattedMessage id="run.paidBy" values={{ address: short(r.payer) }} /></span>}
                    </td>
                    <td className="dim" data-label={col.exercise}>{titleOf(r.problem)}</td>
                    <td className={o.tone}>{say(o.label)}</td>
                    <td className="num" data-label={col.questions}>{r.probes}</td>
                    <td className="num" data-label={col.cost}><Amount value={r.spend} /></td>
                    <td className="num dim" data-label={col.when}>{say(since(r.startedAt))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
