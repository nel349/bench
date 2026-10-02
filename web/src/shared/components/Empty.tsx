import type { ReactNode } from "react";

export interface EmptyProps {
  readonly count: number;
  readonly noun: string;
  readonly children: ReactNode;
  readonly action?: { readonly href: string; readonly label: string };
}

/**
 * Nothing here yet, said as a statement rather than a gap.
 *
 * Early on this is what most visitors see on the gigs and the record, so it cannot be a line of text
 * in the corner of an empty screen. A large zero, what would be here, and the way to get there — and
 * nothing invented to fill the space, because a board of example gigs would read as real ones.
 */
export function Empty({ count, noun, children, action }: EmptyProps) {
  return (
    <div className="empty-state">
      <div className="empty-count">{count}</div>
      <div className="empty-noun">{noun}</div>
      <div className="empty-body">{children}</div>
      {action && <a className="btn primary" href={action.href}>{action.label}</a>}
    </div>
  );
}
