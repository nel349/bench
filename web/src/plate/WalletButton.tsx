import { short } from "../lib/elapsed.ts";
import { viewHref } from "./useView.ts";

export interface WalletButtonProps {
  /** The connected wallet, or `null`. */
  readonly owner: string | null;
  /** Where Connect wallet goes; `null` hides it, where no wallet serves this network. */
  readonly connectHref: string | null;
  readonly onDisconnect: () => void;
  /** Whether the owner's page is the one showing. */
  readonly current: boolean;
}

/**
 * The wallet's place in the header: Connect wallet, or the wallet that is connected, its agents one
 * click away, and a way to disconnect. Presentational; the connection lives in `useOwnerWallet`.
 */
export function WalletButton({ owner, connectHref, onDisconnect, current }: WalletButtonProps) {
  if (owner === null) {
    return connectHref === null ? null : <a className="wallet-connect" href={connectHref}>Connect wallet</a>;
  }
  return (
    <span className="wallet-chip">
      <a href={viewHref("yours", owner)} className={current ? "nav-item on" : "nav-item"}
         aria-current={current ? "page" : undefined}>
        <span className="n">//</span>Your agents
      </a>
      <span className="wallet-address" title={owner}>{short(owner)}</span>
      <button type="button" className="wallet-disconnect" onClick={onDisconnect}>Disconnect</button>
    </span>
  );
}
