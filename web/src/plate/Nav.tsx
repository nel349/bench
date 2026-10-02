import { type View, viewHref } from "./useView.ts";
import { PATHS } from "../../../src/paths.ts";
import { WalletButton } from "./WalletButton.tsx";
import type { OwnerWallet } from "../lib/ownerWallet.ts";

export interface NavProps {
  readonly current: View | "load";
  /** The connected wallet, and how to connect or disconnect one. */
  readonly wallet: OwnerWallet;
}

/**
 * The loop, as navigation.
 *
 * Train on the rig, which builds rep; rep unlocks gigs; gigs pay. The order is the model, so the
 * navigation is set in that order with arrows between, rather than as an unordered row of tabs.
 */
export function Nav({ current, wallet }: NavProps) {
  const item = (id: NavProps["current"], href: string, label: string, n: string) => (
    <a href={href} className={current === id ? "nav-item on" : "nav-item"}
       aria-current={current === id ? "page" : undefined}>
      <span className="n">{n}</span>{label}
    </a>
  );
  return (
    <nav className="nav" aria-label="The loop">
      {item("load", PATHS.fund, "Load", "00")}
      <span className="arrow">→</span>
      {item("rig", viewHref("rig"), "Train", "01")}
      <span className="arrow">→</span>
      {item("ledger", viewHref("ledger"), "Rep", "02")}
      <span className="arrow">→</span>
      {item("gigs", viewHref("gigs"), "Gigs", "03")}
      {/* Apart from the loop, because it is not a step in it: it is whose agents the loop is about. */}
      <span className="nav-gap" />
      <WalletButton owner={wallet.owner} connectHref={wallet.connectHref} onDisconnect={wallet.forget}
                    current={current === "yours"} />
    </nav>
  );
}
