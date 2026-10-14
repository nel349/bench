import type { SettingsWire } from "../../src/shared/wire.ts";
import { networkOf, type Network } from "../src/shared/network/network.ts";

/**
 * The two networks, as a gym on each describes itself, so any page can be drawn on either.
 *
 * Built through `networkOf`, the way `App` builds the real one, from settings shaped like the real
 * gyms': testnet has an owner's wallet and mainnet has none yet, and each has its own Gateway.
 */
const SETTINGS = {
  testnet: {
    chainId: 5042002, usdc: "0x3600000000000000000000000000000000000000",
    gateway: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9", probePrice: "0.020000",
    reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713", wallet: "https://wallet.test/", other: null,
  },
  mainnet: {
    chainId: 5042, usdc: "0x3600000000000000000000000000000000000000",
    gateway: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE", probePrice: "0.020000",
    reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63", wallet: null, other: null,
  },
} as const satisfies Record<string, SettingsWire>;

const built = (settings: SettingsWire): Network => {
  const network = networkOf(settings);
  if (network === null) throw new Error("the test's settings name a chain the page cannot use");
  return network;
};

export const TESTNET = built(SETTINGS.testnet);
export const MAINNET = built(SETTINGS.mainnet);

/** Both, by name, for a test that must hold on either: `describe.each(NETWORKS)("on %s", (_name, network) => …)`. */
export const NETWORKS = [["testnet", TESTNET], ["mainnet", MAINNET]] as const;

/** A network with something a gym decides for itself set differently: its wallet, its registry, its counterpart. */
export const on = (base: Network, over: Partial<Pick<Network, "walletUrl" | "registry" | "other">>): Network =>
  ({ ...base, ...over });
