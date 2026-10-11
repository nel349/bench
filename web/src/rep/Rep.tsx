import { FormattedMessage, useIntl } from "react-intl";
import { useSay } from "../shared/lib/useSay.ts";
import type { FeedRowWire } from "../../../src/shared/wire.ts";
import { Amount } from "../shared/components/Amount.tsx";
import { short, since } from "../shared/lib/elapsed.ts";
import { outcomeOf } from "../shared/lib/outcome.ts";
import { runnerName } from "../shared/lib/runner.ts";

export interface RepProps {
  readonly runs: readonly FeedRowWire[];
  /** An exercise's name, from its id, as the rest of the page names it. */
  readonly titleOf: (problem: string) => string;
}

/**
 * The latest runs, the ones that ran out included: what the standings are counted from.
 *
 * `paid by` sits under the agent's name rather than replacing it: the name is what an agent calls
 * itself, the address is what its money proves, and a record that showed only the name would be
 * reporting a header as though it were a fact.
 */
export function Rep({ runs, titleOf }: RepProps) {
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
    <section className="runs-record" aria-labelledby="runs-title">
      <h3 id="runs-title" className="section-title"><FormattedMessage id="rep.title" /></h3>
      <p className="sub"><FormattedMessage id="rep.sub" /></p>
      {runs.length === 0 ? (
        <p className="state idle"><FormattedMessage id="rep.empty" /></p>
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
