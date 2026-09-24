import { expect, test, describe } from "bun:test";
import { createHash } from "node:crypto";
import { drawSeed, fingerprint, stream } from "./seed.ts";

/**
 * The stream checked against a SHA-256 that is not the one it uses.
 *
 * `seed.ts` promises that its one-sentence specification is enough for a stranger to rebuild any
 * instance in any language. This test is that stranger: it follows the sentence with Node's own
 * SHA-256 rather than viem's, and the two must agree number for number.
 */
const byTheSpecification = (seed: string, label: string, count: number): number[] => {
  const out: number[] = [];
  for (let block = 0; out.length < count; block++) {
    const digest = createHash("sha256").update(`${seed}|${label}|${block}`, "utf8").digest();
    for (let w = 0; w < 8 && out.length < count; w++) out.push(digest.readUInt32BE(4 * w) / 2 ** 32);
  }
  return out;
};

describe("the stream is exactly what seed.ts says it is", () => {
  test("it matches an independent SHA-256 across several blocks", () => {
    const next = stream("4242", "blackbox/atoms");
    const got = Array.from({ length: 20 }, () => next());
    expect(got).toEqual(byTheSpecification("4242", "blackbox/atoms", 20));
  });

  test("every number is in [0, 1)", () => {
    const next = stream("any text at all", "a label");
    for (let i = 0; i < 500; i++) {
      const v = next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("labels keep the parts of an instance apart", () => {
    expect(stream("4242", "zendo/rule")()).not.toBe(stream("4242", "zendo/triples")());
  });
});

describe("a run's seed", () => {
  test("is 32 bytes of hex, and never the same twice", () => {
    const seeds = new Set(Array.from({ length: 50 }, drawSeed));
    expect(seeds.size).toBe(50);
    for (const s of seeds) expect(s).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("has a fingerprint anyone can recompute, which reveals nothing about it", () => {
    const seed = drawSeed();
    expect(fingerprint(seed)).toBe(`0x${createHash("sha256").update(seed, "utf8").digest("hex")}`);
    expect(fingerprint(seed)).not.toContain(seed.slice(2));
  });
});
