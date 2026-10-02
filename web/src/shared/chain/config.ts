import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { arcMainnet, arcTestnet } from "./arc.ts";

/**
 * How the app reaches the owner's wallet.
 *
 * `injected` only: this asks a wallet the person already has to send two transactions, and adding
 * WalletConnect would mean a project id, a relay and a QR flow for no gain. There is no account
 * abstraction here and no passkey — the agent pays with its own key, and Circle's Gateway refuses a
 * smart-contract signer outright, so the owner's wallet is never the payer. It is only the funder.
 */
export const wagmiConfig = createConfig({
  chains: [arcTestnet, arcMainnet],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(),
    [arcMainnet.id]: http(),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
