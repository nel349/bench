import { FormattedMessage, useIntl } from "react-intl";
import type { MessageId } from "../strings/StringsProvider.tsx";
import { type View, viewHref } from "./useView.ts";
import { PATHS } from "../../../src/shared/paths.ts";
import { WalletButton } from "./WalletButton.tsx";
import type { OwnerWallet } from "../shared/lib/ownerWallet.ts";

export interface NavProps {
  /** The page showing. Start is a page of its own, at its own path, and not one of the views. */
  readonly current: View | "start";
  /** The connected wallet, and how to connect or disconnect one. */
  readonly wallet: OwnerWallet;
}

/**
 * The pages, in the order an agent's owner needs them: set it up, see how it is doing, see what it
 * is tested on, see who is ahead, see what pays.
 *
 * They were set out as the gym's loop, numbered and joined by arrows: set up, train, rep, gigs. That
 * is how the gym works and not what an owner does. Training is one sentence said to an agent, so a
 * Train tab was a page with nothing on it to do, and the page an owner comes back to sat apart at
 * the end of the row.
 */
export function Nav({ current, wallet }: NavProps) {
  const intl = useIntl();
  const item = (id: NavProps["current"], href: string, label: MessageId) => (
    <a href={href} className={current === id ? "nav-item on" : "nav-item"}
       aria-current={current === id ? "page" : undefined}>
      <FormattedMessage id={label} />
    </a>
  );
  return (
    <nav className="nav" aria-label={intl.formatMessage({ id: "nav.label" })}>
      {item("start", PATHS.fund, "nav.start")}
      {/* A tab always, connected or not. Without a wallet it asks for one. */}
      {item("yours", wallet.owner === null ? viewHref("yours") : viewHref("yours", wallet.owner), "nav.agent")}
      {item("exercises", viewHref("exercises"), "nav.exercises")}
      {item("standings", viewHref("standings"), "nav.standings")}
      {item("gigs", viewHref("gigs"), "nav.gigs")}
      <WalletButton owner={wallet.owner} connectHref={wallet.connectHref} onConnect={wallet.beginConnect}
                    onDisconnect={wallet.forget} />
    </nav>
  );
}
