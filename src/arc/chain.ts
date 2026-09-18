import { defineChain, type Address } from "viem";
import { arcTestnet } from "viem/chains";

/**
 * Arc, both networks, and everything whose address depends on which one you are on.
 *
 * The rule this file exists to enforce: **an address is never a top-level constant.** The previous
 * build kept `GATEWAY` and a chain id at module scope, which was correct right up until there was a
 * second network — and Circle's Gateway is deployed at a *different address* on Arc mainnet than on
 * testnet. Code carrying the testnet address to mainnet finds no contract there and reports that
 * Gateway is missing from the chain, which is the wrong conclusion drawn confidently.
 *
 * So everything network-dependent is keyed by network, and picking a network is the only way to get
 * an address at all.
 */

export type Network = "mainnet" | "testnet";

/**
 * Arc mainnet. Hand-defined because `viem@2.45.3` ships only `arcTestnet`.
 *
 * The published hostnames — `rpc.arc.network`, `rpc.arc.io`, `rpc.mainnet.arc.network` — did not
 * answer `eth_chainId` on 2026-09-17. The thirdweb endpoint did. Override with `ARC_RPC_URL` when a
 * first-party endpoint appears, which is the expected outcome rather than a hope.
 */
export const arcMainnet = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://arc.rpc.thirdweb.com"] } },
  blockExplorers: { default: { name: "ArcScan", url: "https://arcscan.app" } },
});

export { arcTestnet };

/**
 * What lives on a given Arc network.
 *
 * `sessionKeyPlugin` and `erc8004` are **nullable on purpose**. Both are absent from mainnet today,
 * and a caller that needs them has to say what it does about that. The alternative — falling back to
 * the testnet address — is the exact bug this file is written to prevent: it reads as deployed,
 * every call returns empty, and nothing says why.
 */
export interface ArcContracts {
  /** The ERC-20 view over native USDC. Same address on both networks. 6 decimals, and it truncates. */
  readonly usdc: Address;
  /** Circle Gateway. **Different on each network** — the reason this table exists. */
  readonly gatewayWallet: Address;
  readonly gatewayMinter: Address;
  /** ERC-4337 v0.7. Deployed on both. */
  readonly entryPoint: Address;
  /** Circle's `WeightedWebauthnMultisigPlugin`: the passkey owner. Deployed on both. */
  readonly ownerPlugin: Address;
  /** Our port of the session-key plugin — the allowance. Not on mainnet until we deploy it. */
  readonly sessionKeyPlugin: Address | null;
  /** ERC-8004 registries. Present on testnet, **absent from mainnet** as of 2026-09-17. */
  readonly erc8004: {
    readonly identity: Address;
    readonly reputation: Address;
    readonly validation: Address;
  } | null;
}

export const CONTRACTS: Readonly<Record<Network, ArcContracts>> = {
  mainnet: {
    usdc: "0x3600000000000000000000000000000000000000",
    gatewayWallet: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE",
    gatewayMinter: "0x2222222d7164433c4C09B0b0D809a9b52C04C205",
    entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    ownerPlugin: "0x0000000C984AFf541D6cE86Bb697e68ec57873C8",
    sessionKeyPlugin: null,
    erc8004: null,
  },
  testnet: {
    usdc: "0x3600000000000000000000000000000000000000",
    gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
    gatewayMinter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
    entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    ownerPlugin: "0x0000000C984AFf541D6cE86Bb697e68ec57873C8",
    sessionKeyPlugin: "0x669Dd1eDb85ABD00f74186d88124614EE81E6670",
    erc8004: {
      identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
      validation: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
    },
  },
} as const;

/** Which network this process talks to. Testnet unless told otherwise: mainnet costs real money. */
export function network(): Network {
  return process.env["ARC_NETWORK"] === "mainnet" ? "mainnet" : "testnet";
}

export function chainOf(n: Network) {
  return n === "mainnet" ? arcMainnet : arcTestnet;
}

export function contractsOf(n: Network): ArcContracts {
  return CONTRACTS[n];
}

/** `ARC_RPC_URL` wins, so a better endpoint can be supplied without a release. */
export function rpcUrl(n: Network): string {
  return process.env["ARC_RPC_URL"] ?? chainOf(n).rpcUrls.default.http[0];
}

export function explorerUrl(n: Network): string {
  return chainOf(n).blockExplorers.default.url;
}

/**
 * The path Circle's modular transport takes, appended to the client URL.
 *
 * A **LIVE_API** key is required for `/arc` and a **TEST_API** key for `/arcTestnet`; using either
 * on the wrong network answers `TEST_API key cannot be used with blockchain mainnets`. That message
 * names the tier, not the chain — the path itself routes fine.
 */
export function circleTransportPath(n: Network): "/arc" | "/arcTestnet" {
  return n === "mainnet" ? "/arc" : "/arcTestnet";
}

/** CAIP-2, which is how x402 names a chain in a `402`. */
export function caip2(n: Network): `eip155:${number}` {
  return `eip155:${chainOf(n).id}`;
}

/**
 * What this process needs on chain before it can serve a single paid request.
 *
 * The mainnet table is honest about absence: `sessionKeyPlugin` and `erc8004` are null until they
 * are deployed. Honesty is not enough on its own — without this check the server boots happily on
 * mainnet and fails at the first allowance, somewhere far from the cause.
 *
 * So: say it once, at startup, naming exactly what is missing and what to do about it.
 */
export interface Requirements {
  /** Paid attempts need the allowance, which needs the plugin. */
  readonly allowance: boolean;
  /** Ratings written on chain need the registries. Off means a server-side record instead. */
  readonly onChainRatings: boolean;
}

export function missingContracts(n: Network, need: Requirements): string[] {
  const c = CONTRACTS[n];
  const missing: string[] = [];
  if (need.allowance && c.sessionKeyPlugin === null) {
    missing.push(`sessionKeyPlugin is not deployed on ${n} — deploy it and fill in CONTRACTS.${n}`);
  }
  if (need.onChainRatings && c.erc8004 === null) {
    missing.push(`ERC-8004 is not deployed on ${n} — deploy the registries, or run with onChainRatings off`);
  }
  return missing;
}

/** Throws with everything that is missing at once, rather than one thing per restart. */
export function requireContracts(n: Network, need: Requirements): ArcContracts {
  const missing = missingContracts(n, need);
  if (missing.length > 0) {
    throw new Error(`Cannot serve on Arc ${n}:\n  - ${missing.join("\n  - ")}`);
  }
  return CONTRACTS[n];
}
