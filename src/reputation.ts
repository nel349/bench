import type { Usdc } from "./money.ts";

/**
 * Where a ranked run is written, and where a rating is read back from.
 *
 * On Arc it is the ERC-8004 reputation registry: an entry on the agent's identity, signed by the
 * gym's scribe key, which any stranger can read and filter to that key. The point of putting it
 * there is that a poster can check an agent's record without trusting us, so the bounty gate reads
 * it back from there too, the same way a stranger would, rather than from our database.
 *
 * A seam, like `Payments`: the chain is one implementation and `MemoryReputation` the other. The
 * lifecycle and the gate never know which they have.
 */
export interface Entry {
  /** The ERC-8004 identity the run was proven to belong to. */
  readonly agentId: bigint;
  readonly problem: string;
  /** What solving it cost. The gym's score, and what the entry records. */
  readonly cost: Usdc;
  /** Where the gym answers. */
  readonly endpoint: string;
  /** Where this run's public record can be read. */
  readonly uri: string;
  /** keccak256 of that record, so a reader can check it is the one the entry was written for. */
  readonly hash: `0x${string}`;
}

export interface Reputation {
  /** The address whose entries count. A reader trusts this key's entries and nobody else's. */
  readonly scribe: string;
  /** Writes one entry, and says where: a transaction hash on a chain. Throws if it did not land. */
  write(entry: Entry): Promise<string>;
  /** The problems this identity has a ranked run on, each once, from entries by `scribe` only. */
  ranked(agentId: bigint): Promise<readonly string[]>;
}

/**
 * The ledger kept in memory, for development and for the tests of everything around it.
 *
 * It keeps the same promises the chain does: entries are only ever added, they belong to the
 * identity they were written for, and reading one back gives each problem once.
 */
export class MemoryReputation implements Reputation {
  readonly scribe: string;
  readonly #entries = new Map<bigint, Entry[]>();
  #written = 0;

  constructor(scribe = "memory:scribe") { this.scribe = scribe; }

  async write(entry: Entry): Promise<string> {
    this.#entries.set(entry.agentId, [...(this.#entries.get(entry.agentId) ?? []), entry]);
    return `memory:${++this.#written}`;
  }

  async ranked(agentId: bigint): Promise<readonly string[]> {
    return [...new Set((this.#entries.get(agentId) ?? []).map((e) => e.problem))];
  }

  /** Everything written for an identity, in order. Only the tests ask. */
  entriesOf(agentId: bigint): readonly Entry[] { return this.#entries.get(agentId) ?? []; }
}
