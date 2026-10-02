import type { ProblemDetailWire } from "../../../src/wire.ts";
import { Amount } from "./Amount.tsx";
import { parCost, probes } from "../lib/par.ts";
import { PATHS } from "../../../src/paths.ts";

export interface ExerciseCardProps {
  readonly problem: ProblemDetailWire;
  /** Its place on the rack, from 1. */
  readonly number: number;
}

/**
 * One exercise, as the gym states it: the rule, how hard, what par is and what par costs.
 *
 * Every figure here is the gym's own. Par is shown twice, in probes and in dollars, because the
 * dollars are the score and the probes are how you get there. Where nobody has proven a par, the
 * card says so rather than showing a number that would be read as one.
 */
export function ExerciseCard({ problem, number }: ExerciseCardProps) {
  const par = parCost(problem.par, problem.prices.ask);
  return (
    <header className="exercise">
      <div className="ex-line">
        <span className="ex-no">Exercise {String(number).padStart(2, "0")}</span>
        <span className={`level-tag ${problem.level}`}>{problem.level}</span>
        <span className="ex-skill">{problem.category}</span>
      </div>
      <h2 className="ex-name">{problem.title}</h2>
      <p className="ex-rule">{problem.statement}</p>
      <dl className="ex-stats">
        <div><dt>Par</dt><dd>{problem.par === null ? <span className="none">none proven</span> : <>{probes(problem.par)}</>}</dd></div>
        <div><dt>Par costs</dt><dd>{par === null ? <span className="none">n/a</span> : <Amount value={par} />}</dd></div>
        <div><dt>Per probe</dt><dd><Amount value={problem.prices.ask} /></dd></div>
        <div><dt>To rank</dt><dd><Amount value={problem.prices.rank} /></dd></div>
      </dl>
      {/* The card said what the problem is and not how an agent gets to it. */}
      <p className="ex-start">Your agent plays this itself, through the Bench skill. To set it up, follow the
        steps on <a href={PATHS.fund}>Load</a>.</p>
    </header>
  );
}
