import { FormattedMessage } from "react-intl";
import { useBoard, useProblem } from "../shared/api/useGym.ts";
import { ExerciseCard } from "./ExerciseCard.tsx";
import { Leaderboard } from "./Leaderboard.tsx";

export interface ExerciseProps {
  readonly id: string;
  readonly number: number;
  /** Where this exercise's demo is, for the one that has one. */
  readonly demoHref: string | null;
}

/** One exercise, read from the gym: its card and its leaderboard. */
export function Exercise({ id, number, demoHref }: ExerciseProps) {
  const problem = useProblem(id);
  const board = useBoard(id);
  if (problem.isError) return <p className="state bad"><FormattedMessage id="exercise.missing" values={{ id }} /></p>;
  if (!problem.data) return <p className="state idle"><FormattedMessage id="exercise.loading" values={{ id }} /></p>;
  return (
    <section className="exhibit exercise-view" aria-label={problem.data.title}>
      <ExerciseCard problem={problem.data} number={number} />
      {demoHref && <a className="ex-switch" href={demoHref}><FormattedMessage id="exercise.watchDemo" /></a>}
      <Leaderboard rows={board.data ?? []} title={problem.data.title} />
    </section>
  );
}
