import { FormattedMessage, useIntl } from "react-intl";
import type { ProblemWire } from "../../../src/shared/wire.ts";
import { viewHref } from "../shell/useView.ts";

export interface ExerciseRailProps {
  /** In the order to show them. */
  readonly problems: readonly ProblemWire[];
  readonly chosen: string;
}

/** Filled marks for how hard, out of three: easy one, medium two, hard three. */
const MARKS = { easy: 1, medium: 2, hard: 3 } as const;

/**
 * The rack: every exercise in the gym, along the top of one exercise's page, so the next is a tap
 * away. The first link goes back to the list of them all.
 *
 * Each is a link, so a chosen exercise has an address of its own and survives a reload. They were
 * numbered once, by the order the gym happened to list them in, which meant nothing to a reader.
 */
export function ExerciseRail({ problems, chosen }: ExerciseRailProps) {
  const intl = useIntl();
  return (
    <nav className="rail" aria-label={intl.formatMessage({ id: "exercise.rail" })}>
      <a href={viewHref("exercises")} className="rail-item rail-all"><FormattedMessage id="exercise.all" /></a>
      {problems.map((p) => (
        <a key={p.id} href={viewHref("exercises", p.id)} className={p.id === chosen ? "rail-item on" : "rail-item"}
           aria-current={p.id === chosen ? "true" : undefined}>
          <span className="rail-name">{p.title}</span>
          <span className={`rail-level ${p.level}`} aria-label={intl.formatMessage({ id: `level.${p.level}` })}
                title={intl.formatMessage({ id: `level.${p.level}` })}>
            {[1, 2, 3].map((n) => <i key={n} className={n <= MARKS[p.level] ? "on" : ""} />)}
          </span>
        </a>
      ))}
    </nav>
  );
}
