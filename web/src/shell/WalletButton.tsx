import { FormattedMessage } from "react-intl";
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
 * The wallet's place in the header: Connect wallet, or the wallet that is connected and a way to
 * disconnect. Its agents are a tab of their own, in `Nav`. Presentational; the connection lives in
 * `useOwnerWallet`.
 */
export function WalletButton({ owner, connectHref, onConnect, onDisconnect }: WalletButtonProps) {
  if (owner === null) {
    return connectHref === null ? null : <a className="wallet-connect" href={connectHref} onClick={onConnect}><FormattedMessage id="wallet.connect" /></a>;
  }
  return (
    <span className="wallet-chip">
      <span className="wallet-address" title={owner}>{short(owner)}</span>
      <button type="button" className="wallet-disconnect" onClick={onDisconnect}><FormattedMessage id="wallet.disconnect" /></button>
    </span>
  );
}
