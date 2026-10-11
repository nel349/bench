import { describe, expect, test } from "bun:test";
import { Attempts } from "../../src/gym/attempt.ts";
import type { Charge } from "../../src/gym/payments.ts";
import { identitiesByPayer } from "../../src/http/reads.ts";
import "../../src/problems/blackbox.ts";

/** Runs paid for by `payer`, each started under the identity given, oldest first. */
async function runsOf(payer: string, identities: readonly bigint[]) {
  const attempts = new Attempts(
    { async charge(_agent, amount): Promise<Charge> { return { ok: true, paid: amount, spentSoFar: 0n, payer }; }, spentBy: () => 0n },
    undefined,
    async () => true,
  );
  for (const identity of identities) {
    const run = attempts.start("anonymous", "blackbox", `seed-${identity}`, null, identity)!;
    await attempts.ask(run.id, { side: "up", index: 0 });
    // Each a moment after the last, so "newest" means something.
    await Bun.sleep(2);
  }
  return attempts.all();
}

describe("the identity a paying address is named by", () => {
  /**
   * An agent that set up a second identity is named by the one its latest run carries. Named by its
   * oldest, a win was written against an identity the agent had stopped using.
   */
  test("is the one its newest run carries, whatever order the record is read in", async () => {
    const all = await runsOf("0xPAYER", [7n, 9n]);
    expect(identitiesByPayer(all).get("0xpayer")).toBe("9");
    expect(identitiesByPayer([...all].reverse()).get("0xpayer")).toBe("9");
  });

  test("is found by the address in lower case, and a run with no identity names nobody", async () => {
    const attempts = new Attempts({
      async charge(_agent, amount): Promise<Charge> { return { ok: true, paid: amount, spentSoFar: 0n, payer: "0xNoId" }; },
      spentBy: () => 0n,
    });
    const run = attempts.start("anonymous", "blackbox", "seed")!;
    await attempts.ask(run.id, { side: "up", index: 0 });
    const named = identitiesByPayer([...attempts.all(), ...await runsOf("0xABC", [3n])]);
    expect(named.get("0xabc")).toBe("3");
    expect(named.has("0xnoid")).toBe(false);
    expect(named.has("0xABC")).toBe(false);
  });
});
