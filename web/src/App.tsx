import { FormattedMessage } from "react-intl";
import { useQuery } from "@tanstack/react-query";
import { getAddress } from "viem";
import { getJson } from "./shared/api/client.ts";
import type { SettingsWire } from "../../src/shared/wire.ts";
import { PATHS } from "../../src/shared/paths.ts";
import { isArcChainId } from "./shared/chain/arc.ts";
import { SetUp } from "./setup/SetUp.tsx";
import { Home } from "./shell/Home.tsx";

/**
 * What the server is serving, asked once at startup.
 *
 * The contract addresses are **not** hard-coded here, and neither is their shape: it is
 * `SettingsWire`, the same type the server builds the response from. The server knows which network it is on, and
 * a copy in the browser is a copy that can drift — which is how a page ends up sending money to a
 * testnet address on mainnet.
 */

/** How often to ask again while the gym does not answer. */
const GYM_RETRY_MS = 5_000;

export function App() {
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: ({ signal }) => getJson<SettingsWire>(PATHS.settings, signal),
    staleTime: Infinity,
    // Asked again while the gym does not answer, so the page recovers when it comes back.
    refetchInterval: (query) => (query.state.status === "error" ? GYM_RETRY_MS : false),
  });

  if (settings.isPending) return <div className="wrap narrow"><p className="lede"><FormattedMessage id="app.loading" /></p></div>;
  // A gym that does not answer is not a wrong network, and was reported as one.
  if (settings.isError) {
    return (
      <div className="wrap narrow">
        <p className="verdict bad"><FormattedMessage id="app.gymDown" /></p>
      </div>
    );
  }
  if (!isArcChainId(settings.data?.chainId)) {
    return (
      <div className="wrap narrow">
        <p className="verdict bad"><FormattedMessage id="app.wrongNetwork" /></p>
      </div>
    );
  }

  /**
   * Two pages, so a path check rather than a router.
   *
   * A router earns its place with nested layouts, loaders or more than a handful of routes. With
   * two it would be a dependency, a build step and an abstraction standing in front of an `if`.
   */
  if (window.location.pathname.startsWith(PATHS.fund)) {
    return (
      <SetUp
        chainId={settings.data.chainId}
        usdc={getAddress(settings.data.usdc)}
        gateway={getAddress(settings.data.gateway)}
        probePrice={settings.data.probePrice}
        wallet={settings.data.wallet}
        gym={window.location.origin}
        initialAgent={new URLSearchParams(window.location.search).get("agent")}
      />
    );
  }
  return <Home chainId={settings.data.chainId} probePrice={settings.data.probePrice}
               registry={settings.data.reputation} walletUrl={settings.data.wallet} />;
}
