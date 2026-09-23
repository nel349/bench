import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { getJson } from "./api/client.ts";
import { isArcChainId } from "./chain/arc.ts";
import { Fund } from "./pages/Fund.tsx";
import { Home } from "./pages/Home.tsx";

/**
 * What the server is serving, asked once at startup.
 *
 * The contract addresses are **not** hard-coded here. The server knows which network it is on, and
 * a copy in the browser is a copy that can drift — which is how a page ends up sending money to a
 * testnet address on mainnet.
 */
interface Settings {
  readonly chainId: number;
  readonly usdc: Address;
  readonly gateway: Address;
  readonly probePrice: string;
}

export function App() {
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: ({ signal }) => getJson<Settings>("/settings", signal),
    staleTime: Infinity,
  });

  if (settings.isPending) return <div className="wrap narrow"><p className="lede">Loading…</p></div>;
  if (settings.isError || !isArcChainId(settings.data?.chainId)) {
    return (
      <div className="wrap narrow">
        <p className="verdict bad">This server is not on a network this page can write to.</p>
      </div>
    );
  }

  /**
   * Two pages, so a path check rather than a router.
   *
   * A router earns its place with nested layouts, loaders or more than a handful of routes. With
   * two it would be a dependency, a build step and an abstraction standing in front of an `if`.
   */
  if (window.location.pathname.startsWith("/fund")) {
    return (
      <Fund
        chainId={settings.data.chainId}
        usdc={settings.data.usdc}
        gateway={settings.data.gateway}
        probePrice={settings.data.probePrice}
        initialAgent={new URLSearchParams(window.location.search).get("agent")}
      />
    );
  }
  return <Home chainId={settings.data.chainId} probePrice={settings.data.probePrice} />;
}
