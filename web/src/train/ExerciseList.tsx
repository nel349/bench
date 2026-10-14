import { Explained } from "../shared/components/Explained.tsx";
import { FormattedMessage } from "react-intl";
import type { BestWire, ProblemWire } from "../../../src/shared/wire.ts";
import { LEVEL_WEIGHT } from "../../../src/problems/problem.ts";
import { viewHref } from "../shell/useView.ts";
import { Amount } from "../shared/components/Amount.tsx";
import { recordStanding } from "./record.ts";
import { PATHS } from "../../../src/shared/paths.ts";

export interface ExerciseListProps {
  /** In the order to show them. */
  readonly problems: readonly ProblemWire[];
  /** The record on each exercise that has one. */
  readonly best: readonly BestWire[];
  /** The identities of the connected wallet's agents, so a record of theirs is said to be theirs. */
  readonly mine: readonly string[];
  /** Where the demo run is. */
  readonly demoHref: string;
}

/**
 * Every exercise, each said in a sentence, with the record on it.
 *
 * This is the page for somebody who will never play one: what their agent is being tested on, how
 * hard each is, and what there is to beat. It used to open on one exercise's demo with the others
 * along a rail, which showed how one works and never said what the seven are.
 *
 * Presentational. Each row is one link to that exercise's own page, where its rules and everyone
 * who has solved it are.
 */
export function ExerciseList({ problems, best, mine, demoHref }: ExerciseListProps) {
  const prices = problems[0]?.prices;
  return (
    <section className="board exercises">
      <header className="board-head with-action">
        <div>
          <p className="kicker"><span>//</span> <FormattedMessage id="exercises.kicker" /></p>
          <h2 className="board-title"><FormattedMessage id="exercises.title" /></h2>
          <Explained about="page.about" head={<p className="sub"><FormattedMessage id="exercises.lead" values={{ count: problems.length }} /></p>}>
            <p><FormattedMessage id="exercises.sub" values={{ count: problems.length }} /></p>
          </Explained>
        </div>
        <a className="btn" href={demoHref}><FormattedMessage id="exercises.demo" /></a>
      </header>

      {prices && (
        <div className="price-line">
          {/* The two prices every run meets; how an answer is priced and what a record is worth, behind the "?". */}
          <Explained about="exercises.aboutPrices" head={
            <ul>
              <li><FormattedMessage id="exercises.priceAsk" values={{ price: <Amount value={prices.ask} /> }} /></li>
              <li><FormattedMessage id="exercises.priceRecord" values={{ price: <Amount value={prices.rank} /> }} /></li>
            </ul>
          }>
            <p><FormattedMessage id="exercises.priceAnswer" values={{ price: <Amount value={prices.submit} /> }} /></p>
            <p className="dim"><FormattedMessage id="exercises.repFor" values={LEVEL_WEIGHT} /></p>
          </Explained>
        </div>
      )}

      <ul className="ex-rows">
        {problems.map((p) => {
          const record = best.find((b) => b.problem === p.id);
          const standing = recordStanding(p.par, p.prices.ask, record);
          return (
            // The title is the link, and it is stretched over the row: the whole row opens the exercise, and
            // a screen reader hears the link as the exercise's name and not as forty words.
            <li key={p.id} className="ex-row">
                <div className="ex-what">
                  <h3><a className="ex-link" href={viewHref("exercises", p.id)}>{p.title}</a></h3>
                  <p>{p.summary} <FormattedMessage id="exercises.tests" values={{ skill: p.category }} /></p>
                </div>
                <div className="ex-cell">
                  <span className="cap"><FormattedMessage id="exercises.level" /></span>
                  <span className={`level-word ${p.level}`}><FormattedMessage id={`level.${p.level}`} /></span>
                  <span className="small"><FormattedMessage id="exercises.rep" values={{ rep: LEVEL_WEIGHT[p.level] }} /></span>
                </div>
                <div className="ex-cell">
                  <span className="cap"><FormattedMessage id="exercises.record" /></span>
                  {record === undefined ? (
                    <span className="none"><FormattedMessage id="exercises.noRecord" /></span>
                  ) : <>
                    <Amount value={record.spend} />
                    <span className="small">
                      <FormattedMessage id={mine.includes(record.identity) ? "exercises.heldByYou" : "exercises.heldBy"}
                                        values={{ count: record.probes, id: record.identity }} />
                    </span>
                  </>}
                </div>
                <div className="ex-cell">
                  <span className="cap"><FormattedMessage id="exercise.fewestNeeded" /></span>
                  {p.par === null
                    ? <span className="none"><FormattedMessage id="exercise.notProven" /></span>
                    : <span><FormattedMessage id="count.questions" values={{ count: p.par }} /></span>}
                  {standing === "above" && <span className="tag open"><FormattedMessage id="exercises.recordAbove" /></span>}
                  {standing === "at" && <span className="tag"><FormattedMessage id="exercises.recordAt" /></span>}
                  {standing === "under" && <span className="tag"><FormattedMessage id="exercises.recordUnder" /></span>}
                </div>
            </li>
          );
        })}
      </ul>
      <p className="fine"><FormattedMessage id="exercises.foot" values={{ link: (chunks) => <a href={PATHS.fund}>{chunks}</a> }} /></p>
    </section>
  );
}
