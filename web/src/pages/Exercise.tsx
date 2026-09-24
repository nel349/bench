import { useBoard, useProblem } from "../api/useGym.ts";
import { ExerciseCard } from "../components/ExerciseCard.tsx";
import { Board } from "../components/Board.tsx";

export interface ExerciseProps {
  readonly id: string;
  readonly number: number;
  /** Where this exercise's demo is, for the one that has one. */
  readonly demoHref: string | null;
}

/** One exercise, read from the gym: its card and its board. */
export function Exercise({ id, number, demoHref }: ExerciseProps) {
  const problem = useProblem(id);
  const board = useBoard(id);
  if (problem.isError) return <p className="state bad">The gym has no exercise called {id}.</p>;
  if (!problem.data) return <p className="state idle">Loading {id}…</p>;
  return (
    <section className="exhibit exercise-view" aria-label={problem.data.title}>
      <ExerciseCard problem={problem.data} number={number} />
      {demoHref && <a className="ex-switch" href={demoHref}>Watch the demo</a>}
      <Board rows={board.data ?? []} title={problem.data.title} />
    </section>
  );
}
