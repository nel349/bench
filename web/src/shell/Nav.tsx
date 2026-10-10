import { FormattedMessage, useIntl } from "react-intl";
import type { MessageId } from "../strings/StringsProvider.tsx";
import { type View, viewHref } from "./useView.ts";
import { PATHS } from "../../../src/shared/paths.ts";
import { WalletButton } from "./WalletButton.tsx";
import type { OwnerWallet } from "../shared/lib/ownerWallet.ts";

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
  const intl = useIntl();
  const item = (id: NavProps["current"], href: string, label: MessageId, n: string) => (
    <a href={href} className={current === id ? "nav-item on" : "nav-item"}
       aria-current={current === id ? "page" : undefined}>
      <span className="n">{n}</span><FormattedMessage id={label} />
    </a>
  );
  return (
    <nav className="nav" aria-label={intl.formatMessage({ id: "nav.label" })}>
      {item("load", PATHS.fund, "nav.setUp", "00")}
      <span className="arrow">→</span>
      {item("rig", viewHref("rig"), "nav.train", "01")}
      <span className="arrow">→</span>
      {item("ledger", viewHref("ledger"), "nav.rep", "02")}
      <span className="arrow">→</span>
      {item("gigs", viewHref("gigs"), "nav.gigs", "03")}
      {/*
        * Not a step in the loop but whose agents it is about, and the page an owner comes back to: a
        * tab always, connected or not. Without a wallet it asks for one.
        */}
      <span className="nav-gap" />
      {item("yours", wallet.owner === null ? viewHref("yours") : viewHref("yours", wallet.owner), "nav.yours", "//")}
      <WalletButton owner={wallet.owner} connectHref={wallet.connectHref} onConnect={wallet.beginConnect}
                    onDisconnect={wallet.forget} />
    </nav>
  );
}
