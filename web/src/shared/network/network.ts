import { getAddress, type Address } from "viem";
import type { SettingsWire } from "../../../../src/shared/wire.ts";
import { chainFor, isArcChainId } from "../chain/arc.ts";

/**
 * The network this page is on, in one piece: the chain, where its contracts are, and what does and
 * does not exist there.
 *
 * It is what the gym said when it was asked, and nothing else. The page holds no addresses of its
 * own and does not choose a network: each network has a gym of its own, with its own records and
 * its own money, and a page belongs to the gym that served it. Changing network is going to the
 * other gym, which is what `other` is for.
 *
 * These facts were handed down one prop at a time, a chain id here and an explorer there, and a
 * component that needed one more had to be threaded through every parent on the way. So some did
 * not ask, and said things that are true on one network only.
 */
export interface Network {
  readonly chain: ReturnType<typeof chainFor>;
  /** Whether the money here is test money. */
  readonly testnet: boolean;
  /** Where a transaction or an address on this network can be looked up. */
  readonly explorer: string;
  readonly usdc: Address;
  /** Circle's Gateway, which holds what an agent pays from. */
  readonly gateway: Address;
  /** The ERC-8004 reputation registry, where a record is written. `null` where this gym writes none. */
  readonly registry: string | null;
  /**
   * The owner's wallet, where an allowance is granted and revoked. `null` where none serves this
   * network: there an agent pays from a balance of its own, and there is no owner's page to read.
   */
  readonly walletUrl: string | null;
  /** The same gym on the other Arc network. `null` where this gym names none. */
  readonly other: string | null;
}

/** The network a gym's settings describe, or `null` where the chain is not one this page can use. */
export function networkOf(settings: SettingsWire): Network | null {
  if (!isArcChainId(settings.chainId)) return null;
  const chain = chainFor(settings.chainId);
  return {
    chain,
    testnet: chain.testnet === true,
    explorer: chain.blockExplorers.default.url,
    usdc: getAddress(settings.usdc),
    gateway: getAddress(settings.gateway),
    registry: settings.reputation,
    walletUrl: settings.wallet,
    // A gym older than this page does not say; that is none, and not a link to "undefined".
    other: settings.other ?? null,
  };
}
