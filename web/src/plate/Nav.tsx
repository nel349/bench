import type { View } from "./useView.ts";

export interface NavProps {
  readonly current: View | "load";
}

/**
 * The loop, as navigation.
 *
 * Train on the rig, which builds rep; rep unlocks gigs; gigs pay. The order is the model, so the
 * navigation is set in that order with arrows between, rather than as an unordered row of tabs.
 */
export function Nav({ current }: NavProps) {
  const item = (id: NavProps["current"], href: string, label: string, n: string) => (
    <a href={href} className={current === id ? "nav-item on" : "nav-item"}
       aria-current={current === id ? "page" : undefined}>
      <span className="n">{n}</span>{label}
    </a>
  );
  return (
    <nav className="nav" aria-label="The loop">
      {item("load", "/fund", "Load", "00")}
      <span className="arrow">→</span>
      {item("rig", "/#rig", "Train", "01")}
      <span className="arrow">→</span>
      {item("ledger", "/#ledger", "Rep", "02")}
      <span className="arrow">→</span>
      {item("gigs", "/#gigs", "Gigs", "03")}
    </nav>
  );
}
