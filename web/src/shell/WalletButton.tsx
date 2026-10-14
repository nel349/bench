import { FormattedMessage, useIntl } from "react-intl";
import { short } from "../shared/lib/elapsed.ts";

export interface WalletButtonProps {
  /** The connected wallet, or `null`. */
  readonly owner: string | null;
  /** Where Connect wallet goes; `null` hides it, where no wallet serves this network. */
  readonly connectHref: string | null;
  /** Called as the owner leaves for the wallet, so its answer is known to have been asked for. */
  readonly onConnect: () => void;
  readonly onDisconnect: () => void;
}

/**
 * The wallet's place in the header: Connect Mandate, or the wallet that is connected and a way to
 * disconnect. Named for the wallet it goes to: "Connect wallet" read as the usual browser-wallet
 * button, and then a different site called Mandate opened. Its agents are a tab of their own, in `Nav`. Presentational; the connection lives in
 * `useOwnerWallet`.
 */
export function WalletButton({ owner, connectHref, onConnect, onDisconnect }: WalletButtonProps) {
  const intl = useIntl();
  if (owner === null) {
    return connectHref === null ? null : <a className="wallet-connect" href={connectHref} onClick={onConnect} title={intl.formatMessage({ id: "wallet.connectWhat" })}><FormattedMessage id="wallet.connect" /></a>;
  }
  return (
    <span className="wallet-chip">
      <span className="wallet-address" title={owner}>{short(owner)}</span>
      <button type="button" className="wallet-disconnect" onClick={onDisconnect}><FormattedMessage id="wallet.disconnect" /></button>
    </span>
  );
}
