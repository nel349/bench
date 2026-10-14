import { defineChain, http, type Address } from "viem";
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
 * answer `eth_chainId` on 2026-09-17. The thirdweb endpoint did. A first-party one has appeared
 * since, `rpc.mainnet.arc.io`, which answered on 2026-10-12; `ARC_RPC_URL` points a process at it.
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
 * `sessionKeyPlugin` and `erc8004` are **nullable on purpose**. The plugin is absent from mainnet
 * today, and a caller that needs either has to say what it does about that. The alternative — falling
 * back to the testnet address — is the exact bug this file is written to prevent: it reads as
 * deployed, every call returns empty, and nothing says why.
 *
 * That bug was made once from the other side. ERC-8004 has one set of addresses for testnets and
 * another for mainnets, and on 2026-09-17 the testnet set was looked for on mainnet, found empty,
 * and written down as "not deployed". The registries were there all along, at their mainnet set.
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
  /**
   * Our `BountyEscrow`, which holds a bounty until the gym names a winner.
   *
   * Deployed through CREATE2 with a fixed salt, so the address is the same on any chain **given the
   * same constructor arguments** — and the arbiter is one of them. A different arbiter on mainnet
   * means a different address there, which is the reason the arbiter key is kept rather than
   * regenerated.
   *
   * Null where it is not deployed, like everything else here: knowing where it would land is not
   * the same as it being there.
   */
  readonly bountyEscrow: Address | null;
  /**
   * Our port of the session-key plugin — the allowance.
   *
   * Null until it is deployed on that network, even though the address is already known: see
   * `SESSION_KEY_PLUGIN`. Knowing where it will land is not the same as it being there, and code
   * that calls an empty address gets empty answers with nothing saying why.
   */
  readonly sessionKeyPlugin: Address | null;
  /** ERC-8004 registries. **Different on each network**: the standard keeps one set of addresses for testnets and one for mainnets. */
  readonly erc8004: {
    readonly identity: Address;
    readonly reputation: Address;
    readonly validation: Address;
  } | null;
}

/**
 * Where the session-key plugin lands, on **every** chain.
 *
 * It deploys through Arachnid's canonical CREATE2 factory at `0x4e59b448…4956C`, which is present on
 * Arc mainnet and testnet alike (69 bytes at both, checked 2026-09-17), under the fixed salt
 * `keccak256("kuiralabs.arc-agent-mandate.SessionKeyPlugin.v1")`. The address is a function of
 * deployer, salt and creation code, and all three are the same everywhere — so the mainnet address
 * was knowable before a single mainnet transaction was sent.
 *
 * Deploying to mainnet is therefore mechanical, and costs about $0.07 at current gas. When it is
 * done, `CONTRACTS.mainnet.sessionKeyPlugin` becomes this value and nothing else changes.
 */
export const SESSION_KEY_PLUGIN: Address = "0x669Dd1eDb85ABD00f74186d88124614EE81E6670";

/**
 * The arbiter `BountyEscrow` was deployed with, and therefore part of its address.
 *
 * Recorded so that a deployment can be checked against what it was meant to be. The key itself
 * lives outside any repository, at `~/.bench/arbiter.key`.
 */
export const BOUNTY_ARBITER: Address = "0x9e3383f4aE49E950D72835023A5642983882C099";

export const CONTRACTS: Readonly<Record<Network, ArcContracts>> = {
  mainnet: {
    usdc: "0x3600000000000000000000000000000000000000",
    gatewayWallet: "0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE",
    gatewayMinter: "0x2222222d7164433c4C09B0b0D809a9b52C04C205",
    entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    ownerPlugin: "0x0000000C984AFf541D6cE86Bb697e68ec57873C8",
    // Deployed 14 October 2026, in 0x8ce044bf…7b4b, through the CREATE2 factory: the same 13,132
    // bytes as on testnet, at the address the Mandate's profiles already name.
    sessionKeyPlugin: SESSION_KEY_PLUGIN,
    // Deployed 12 October 2026, in 0xa8f0c8eb…8047. The same address as testnet, as CREATE2 promised.
    bountyEscrow: "0xE2a5aa64855500ae77117D7cb767bFc38b9c4FbB",
    // The mainnet set, as Arc's own contract list gives it. Checked on 2026-10-12: the same proxies
    // and the same implementations as on testnet, version 2.0.0, with the reputation registry
    // pointing at this identity registry.
    erc8004: {
      identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
      reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
      validation: "0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58",
    },
  },
  testnet: {
    usdc: "0x3600000000000000000000000000000000000000",
    gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
    gatewayMinter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
    entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    ownerPlugin: "0x0000000C984AFf541D6cE86Bb697e68ec57873C8",
    sessionKeyPlugin: SESSION_KEY_PLUGIN,
    bountyEscrow: "0xE2a5aa64855500ae77117D7cb767bFc38b9c4FbB",
    erc8004: {
      identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
      validation: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
    },
  },
} as const;

/** The wallet's address, before it is told which network to open on. */
const WALLET_BASE = "https://kuiralabs.github.io/mandate/";
/** Each network by the name the wallet knows it by, which is Circle's. */
const WALLET_NETWORK: Readonly<Record<Network, string>> = { mainnet: "arc", testnet: "arcTestnet" };
/** The parameter the wallet reads to open on a network. */
const WALLET_NETWORK_PARAM = "network";

/**
 * The wallet, told which network to open on. It remembers the network a phone last showed, and a
 * fresh one shows Arc testnet, so without this an owner sent from the mainnet gym arrived in their
 * test wallet, and Connect handed the mainnet gym a testnet address.
 */
function walletOn(net: Network): string {
  const url = new URL(WALLET_BASE);
  url.searchParams.set(WALLET_NETWORK_PARAM, WALLET_NETWORK[net]);
  return url.toString();
}

/**
 * Where an owner opens the wallet their agent spends from: the Agent Mandate app, built for the web.
 *
 * It lives on another host because a passkey belongs to a domain, and Circle checks the app's client
 * key against that domain. The testnet key is bound to this one. Mainnet has none yet: it needs a
 * live Circle client key bound to a mainnet hostname, so the page says so instead of linking to a
 * wallet that would open on the wrong network.
 */
export const OWNER_WALLET: Readonly<Record<Network, string | null>> = {
  // The same wallet: on Arc mainnet it opens with Circle's LIVE key, shared since 14 October.
  mainnet: walletOn("mainnet"),
  testnet: walletOn("testnet"),
};

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

/**
 * How long one read of the chain may take, and how many more times it is tried.
 *
 * Left to the client library a read waits ten seconds and is tried four times, so a node that
 * accepts a connection and then says nothing held a request for forty seconds; the server had
 * closed the socket long before, and the caller got a dropped connection where it was owed "try
 * again". Four seconds, twice, is more than a healthy node ever needs and little enough that a
 * request reading the chain in three steps still answers.
 */
export const READ_TIMEOUT_MS = 4_000;
export const READ_RETRIES = 1;
/** How long the one retry waits before it is made. */
export const READ_RETRY_AFTER_MS = 150;
/**
 * The longest one read takes when the node says nothing at all: every try timing out, and the wait
 * between them. The client doubles that wait with each retry, so this sum is right for one retry
 * and would need redoing for more.
 *
 * Not a bound on every failure. A node that answers "too many requests" and names a wait is waited
 * for, once, for as long as it names; that is the node asking, and asking again sooner would be
 * refused again.
 */
export const SLOWEST_READ_MS = READ_TIMEOUT_MS * (READ_RETRIES + 1) + READ_RETRY_AFTER_MS * READ_RETRIES;

/**
 * The transport for a client that only reads. Anything that sends a transaction, or waits for one,
 * keeps the library's own patience: a receipt takes as long as a block takes.
 */
export const readTransport = (n: Network) =>
  http(rpcUrl(n), { timeout: READ_TIMEOUT_MS, retryCount: READ_RETRIES, retryDelay: READ_RETRY_AFTER_MS });

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
 * The mainnet table is honest about absence: `sessionKeyPlugin` is null until it is deployed. Honesty is not enough on its own — without this check the server boots happily on
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
  return missingFrom(CONTRACTS[n], n, need);
}

/** What `need` asks for that `c` does not have, all of it, said for the network `n`. */
export function missingFrom(c: ArcContracts, n: Network, need: Requirements): string[] {
  const missing: string[] = [];
  if (need.allowance && c.sessionKeyPlugin === null) {
    missing.push(
      `sessionKeyPlugin is not deployed on ${n} yet. It lands at ${SESSION_KEY_PLUGIN} — the same ` +
      `address on every chain, via CREATE2 — so deploy it there and set CONTRACTS.${n}.sessionKeyPlugin`,
    );
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
