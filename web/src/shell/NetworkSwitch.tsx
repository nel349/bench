import { FormattedMessage, useIntl } from "react-intl";
import { useNetwork } from "../shared/network/NetworkProvider.tsx";
import { acrossHref } from "./across.ts";
import { useRoute } from "./useView.ts";

/**
 * Which network this is, what kind of money it takes, and the way to the other one.
 *
 * The network was said once, on the frame's left edge, which a phone does not draw; and nowhere
 * did a page say that the money on mainnet is real. So this is on every page, at every width.
 *
 * The other network is a link to the other network's gym, at the same page: the two do not share a
 * server, so there is nothing to flip in place. Where the gym names no other, only this one is
 * named.
 */
export function NetworkSwitch() {
  const { testnet, other } = useNetwork();
  const intl = useIntl();
  // Read so the link follows the view as it changes; the address itself is what is carried across.
  useRoute();
  const here = <span className="net on" aria-current="true"><FormattedMessage id={testnet ? "network.testnetHere" : "network.mainnetHere"} /></span>;
  const there = other === null ? null : (
    <a className="net" href={acrossHref(other, window.location)}
       title={intl.formatMessage({ id: testnet ? "network.toMainnet" : "network.toTestnet" })}>
      <FormattedMessage id={testnet ? "network.mainnet" : "network.testnet"} />
    </a>
  );
  return (
    <span className={testnet ? "net-switch test" : "net-switch real"} role="group" aria-label={intl.formatMessage({ id: "network.label" })}>
      {testnet ? <>{there}{here}</> : <>{here}{there}</>}
    </span>
  );
}
