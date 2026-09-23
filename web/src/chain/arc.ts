import { defineChain } from "viem";

/**
 * Arc, for the browser.
 *
 * Deliberately a copy of the server's `src/arc/chain.ts` values rather than an import of it: that
 * module reaches for `process.env` and is the server's, and a chain definition is four facts. What
 * must not drift is the **contract addresses**, and those are not here — the server sends them with
 * the page, because it is the thing that knows which network it is serving.
 */
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://arc-testnet.rpc.thirdweb.com"] } },
  blockExplorers: { default: { name: "ArcScan", url: "https://testnet.arcscan.app" } },
  testnet: true,
});

export const arcMainnet = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://arc.rpc.thirdweb.com"] } },
  blockExplorers: { default: { name: "ArcScan", url: "https://arcscan.app" } },
});

/**
 * The chains this app can write to, as a type.
 *
 * wagmi will not accept an arbitrary number as a chain id, and it is right not to: a transaction
 * sent to a chain the config does not know has nowhere to go. So the server's number is narrowed
 * once, at the edge, rather than widened everywhere it is used.
 */
export type ArcChainId = typeof arcTestnet.id | typeof arcMainnet.id;

export const isArcChainId = (id: unknown): id is ArcChainId =>
  id === arcTestnet.id || id === arcMainnet.id;

export const chainFor = (id: ArcChainId) => (id === arcMainnet.id ? arcMainnet : arcTestnet);
