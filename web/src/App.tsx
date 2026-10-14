import { FormattedMessage } from "react-intl";
import { useQuery } from "@tanstack/react-query";
import { getJson } from "./shared/api/client.ts";
import type { SettingsWire } from "../../src/shared/wire.ts";
import { PATHS } from "../../src/shared/paths.ts";
import { networkOf } from "./shared/network/network.ts";
import { NetworkProvider } from "./shared/network/NetworkProvider.tsx";
import { SetUp } from "./setup/SetUp.tsx";
import { Home } from "./shell/Home.tsx";

/**
 * What the server is serving, asked once at startup.
 *
 * The contract addresses are **not** hard-coded here, and neither is their shape: it is
 * `SettingsWire`, the same type the server builds the response from. The server knows which network it is on, and
 * a copy in the browser is a copy that can drift — which is how a page ends up sending money to a
 * testnet address on mainnet.
 *
 * What it says becomes the page's one `Network`, given to everything below through
 * `NetworkProvider`, so no component is handed a network fact by its parent or keeps one of its own.
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
  const network = networkOf(settings.data);
  if (network === null) {
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
  const start = window.location.pathname.startsWith(PATHS.fund);
  return (
    <NetworkProvider network={network}>
      {start
        ? <SetUp probePrice={settings.data.probePrice} gym={window.location.origin}
                 initialAgent={new URLSearchParams(window.location.search).get("agent")} />
        : <Home probePrice={settings.data.probePrice} />}
    </NetworkProvider>
  );
}
