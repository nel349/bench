import { FormattedMessage } from "react-intl";
import type { ProblemDetailWire } from "../../../src/shared/wire.ts";
import { Amount } from "../shared/components/Amount.tsx";
import { parCost } from "./par.ts";
import { PATHS } from "../../../src/shared/paths.ts";

export interface ExerciseCardProps {
  readonly problem: ProblemDetailWire;
}

/**
 * One exercise, as the gym states it: the rule, how hard, the fewest questions it needs and what
 * those cost.
 *
 * Every figure here is the gym's own. The fewest is shown twice, in questions and in dollars, because
 * the dollars are the score and the questions are how you get there. Where nobody has proven a
 * fewest, the card says so rather than showing a number that would be read as one.
 */
export function ExerciseCard({ problem }: ExerciseCardProps) {
  const par = parCost(problem.par, problem.prices.ask);
  return (
    <header className="exercise">
      <div className="ex-line">
        <span className={`level-tag ${problem.level}`}><FormattedMessage id={`level.${problem.level}`} /></span>
        <span className="ex-skill">{problem.category}</span>
      </div>
      <h2 className="ex-name">{problem.title}</h2>
      <p className="ex-rule">{problem.statement}</p>
      <dl className="ex-stats">
        <div>
          <dt><FormattedMessage id="exercise.fewestNeeded" /></dt>
          <dd>
            {problem.par === null
              ? <span className="none"><FormattedMessage id="exercise.notProven" /></span>
              : <FormattedMessage id="count.questions" values={{ count: problem.par }} />}
          </dd>
        </div>
        <div>
          <dt><FormattedMessage id="exercise.fewestCost" /></dt>
          <dd>{par === null ? <span className="none"><FormattedMessage id="exercise.notApplicable" /></span> : <Amount value={par} />}</dd>
        </div>
        <div><dt><FormattedMessage id="exercise.perQuestion" /></dt><dd><Amount value={problem.prices.ask} /></dd></div>
        <div><dt><FormattedMessage id="exercise.toRecord" /></dt><dd><Amount value={problem.prices.rank} /></dd></div>
      </dl>
      {/* The card said what the problem is and not how an agent gets to it. */}
      <p className="ex-start">
        <FormattedMessage id="exercise.start" values={{ link: (chunks) => <a href={PATHS.fund}>{chunks}</a> }} />
      </p>
    </header>
  );
}
