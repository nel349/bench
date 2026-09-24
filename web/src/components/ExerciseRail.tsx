import type { ProblemWire } from "../../../src/wire.ts";

export interface ExerciseRailProps {
  readonly problems: readonly ProblemWire[];
  readonly chosen: string;
}

/** Filled marks for how hard, out of three: easy one, medium two, hard three. */
const MARKS = { easy: 1, medium: 2, hard: 3 } as const;

/**
 * The rack: every exercise in the gym, in the order the gym serves them.
 *
 * Numbered, because the demo already calls Black Box "Exercise 01", and a number is a way to point at
 * one. Each is a link, so a chosen exercise has an address of its own and survives a reload.
 */
export function ExerciseRail({ problems, chosen }: ExerciseRailProps) {
  return (
    <nav className="rail" aria-label="Exercises">
      {problems.map((p, i) => (
        <a key={p.id} href={`#rig/${p.id}`} className={p.id === chosen ? "rail-item on" : "rail-item"}
           aria-current={p.id === chosen ? "true" : undefined}>
          <span className="rail-no">{String(i + 1).padStart(2, "0")}</span>
          <span className="rail-name">{p.title}</span>
          <span className={`rail-level ${p.level}`} aria-label={p.level}>
            {[1, 2, 3].map((n) => <i key={n} className={n <= MARKS[p.level] ? "on" : ""} />)}
          </span>
        </a>
      ))}
    </nav>
  );
}
