import { createContext, useContext, type ReactNode } from "react";
import type { Network } from "./network.ts";

const NetworkContext = createContext<Network | null>(null);

/** Gives everything under it the network the gym is on. `App` does this once, with what the gym said. */
export function NetworkProvider({ network, children }: { readonly network: Network; readonly children: ReactNode }) {
  return <NetworkContext.Provider value={network}>{children}</NetworkContext.Provider>;
}

/**
 * The network this page is on.
 *
 * It throws where none was given. A default would be a network picked by the page, and a page that
 * guesses its network is how money is sent to an address from the wrong one.
 */
export function useNetwork(): Network {
  const network = useContext(NetworkContext);
  if (network === null) throw new Error("useNetwork was called outside a NetworkProvider");
  return network;
}
