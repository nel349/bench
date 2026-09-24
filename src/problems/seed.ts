import { bytesToHex, sha256, stringToBytes } from "viem";

/**
 * Where every instance comes from, and why an agent cannot get there first.
 *
 * A seed is text. Any text rebuilds an instance, so `?seed=4242` at the harness is a fine way to
 * practise. A *run's* seed is different only in who chose it and how large it is: the gym draws 32
 * random bytes, keeps them secret while the run is open, and shows the fingerprint instead.
 *
 * This replaced mulberry32. That generator took a 32-bit seed, and a problem that publishes part of
 * its instance, as Zendo publishes its twenty triples, could be matched against all four billion
 * seeds offline to recover the part it does not. The size of the secret is what closes that, not
 * the secrecy alone. `FINDINGS.md` 26 in the plans repository has the whole story.
 */
export type Seed = string;

/** How many random bytes a run's seed carries. */
const SEED_BYTES = 32;
/** Each SHA-256 block is 32 bytes, read as eight 32-bit words. */
const WORDS_PER_BLOCK = 8;
const WORD = 2 ** 32;

/**
 * A stream of numbers in [0, 1) drawn from a seed, for one named part of an instance.
 *
 * Block `n` is SHA-256 of the UTF-8 text `<seed>|<label>|<n>`, counting from zero, read as eight
 * big-endian 32-bit words, each divided by 2^32. That sentence is the whole specification: any
 * SHA-256 in any language reproduces it, which is what lets a stranger rebuild a run.
 *
 * The label keeps the parts of an instance apart. Zendo's hidden rule and its published triples
 * never share a stream, so knowing the triples says nothing about which stream the rule came from.
 */
export function stream(seed: Seed, label: string): () => number {
  let block = 0;
  let words: DataView = new DataView(new ArrayBuffer(0));
  let at = WORDS_PER_BLOCK;
  return () => {
    if (at === WORDS_PER_BLOCK) {
      const digest = sha256(stringToBytes(`${seed}|${label}|${block++}`), "bytes");
      words = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
      at = 0;
    }
    return words.getUint32(4 * at++) / WORD;
  };
}

/** A run's seed: 32 bytes from the platform's cryptographic source, as hex. */
export function drawSeed(): Seed {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(SEED_BYTES)));
}

/**
 * What a run shows in place of its seed while it is open: SHA-256 of the seed's UTF-8 text.
 *
 * It commits the gym to the instance without revealing it. When the run ends the seed is published,
 * and anyone can hash it and compare.
 */
export function fingerprint(seed: Seed): string {
  return sha256(stringToBytes(seed));
}
