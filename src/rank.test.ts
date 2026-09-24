import { expect, test, describe, beforeEach } from "bun:test";
import { Attempts, recordHash, wireAttempt, wireRecord, type Attempt } from "./attempt.ts";
import { InMemoryAllowance } from "./payments.ts";
import { MemoryReputation } from "./reputation.ts";
import { usdc } from "./money.ts";
import { PRICE } from "./pricing.ts";
import { boardFrom } from "./problems/blackbox.ts";
import { keccak256, stringToBytes } from "viem";
import "./problems/blackbox-problem.ts";

const AGENT = "agent:aria";
const ID = 42n;
const SEED = "4242";

let money: InMemoryAllowance;
let attempts: Attempts;
let ledger: MemoryReputation;
let writes: number;

beforeEach(() => {
  money = new InMemoryAllowance();
  money.grant(AGENT, usdc("5"));
  attempts = new Attempts(money, undefined, async (id, payer) => id === ID && payer === AGENT);
  ledger = new MemoryReputation();
  writes = 0;
});

/** Writes to the in-memory ledger, the way the route writes to the chain. */
const write = (a: Attempt, agentId: bigint) => {
  writes++;
  return ledger.write({ agentId, problem: a.problem, cost: a.spend, endpoint: "e", uri: "u", hash: recordHash(a) });
};

/** Solved, paid for, and under a proven identity, unless told otherwise. */
async function run(opts: { claim?: bigint | null; pay?: boolean; solve?: boolean } = {}): Promise<Attempt> {
  const a = attempts.start(AGENT, "blackbox", SEED, null, opts.claim === undefined ? ID : opts.claim)!;
  if (opts.pay !== false) await attempts.ask(a.id, { side: "up", index: 0 });
  if (opts.solve !== false) await attempts.submit(a.id, boardFrom(SEED).atoms);
  return attempts.get(a.id)!;
}

describe("what cannot be ranked is refused, and costs nothing", () => {
  test("an unsolved run", async () => {
    const a = await run({ solve: false });
    const before = money.spentBy(AGENT);
    expect(await attempts.rank(a.id, write)).toMatchObject({ notRankable: expect.stringContaining("solved") });
    expect(money.spentBy(AGENT)).toBe(before);
    expect(writes).toBe(0);
  });

  test("a run nobody paid for, solved by the free first submission", async () => {
    const a = await run({ pay: false });
    expect(a.outcome).toBe("solved");
    expect(await attempts.rank(a.id, write)).toMatchObject({ notRankable: expect.stringContaining("nobody paid") });
    expect(money.spentBy(AGENT)).toBe(0n);
  });

  test("a run with no proven identity, whether none was claimed or the claim did not check out", async () => {
    for (const claim of [null, 7n]) {
      const a = await run({ claim });
      const before = money.spentBy(AGENT);
      expect(await attempts.rank(a.id, write)).toMatchObject({ notRankable: expect.stringContaining("X-Agent-Id") });
      expect(money.spentBy(AGENT)).toBe(before);
    }
    expect(writes).toBe(0);
  });
});

describe("ranking a solved run", () => {
  test("charges $0.25 once and writes one entry to the identity", async () => {
    const a = await run();
    const before = money.spentBy(AGENT);
    const out = await attempts.rank(a.id, write);
    expect(out).toMatchObject({ ranked: "memory:1", paid: PRICE.rank });
    expect(money.spentBy(AGENT) - before).toBe(PRICE.rank);
    expect(ledger.entriesOf(ID)).toHaveLength(1);
    expect(ledger.entriesOf(ID)[0]).toMatchObject({ problem: "blackbox", cost: a.spend });
    expect(wireAttempt(attempts.get(a.id)!).ranked).toEqual({ tx: "memory:1" });
  });

  test("the cost to solve is not changed by the fee to rank", async () => {
    const a = await run();
    const spend = a.spend;
    await attempts.rank(a.id, write);
    expect(attempts.get(a.id)!.spend).toBe(spend);
  });

  test("asking again returns the same entry, free, and writes nothing more", async () => {
    const a = await run();
    await attempts.rank(a.id, write);
    const before = money.spentBy(AGENT);
    expect(await attempts.rank(a.id, write)).toMatchObject({ ranked: "memory:1", paid: 0n });
    expect(money.spentBy(AGENT)).toBe(before);
    expect(writes).toBe(1);
  });

  test("a write that fails after the charge is retried for nothing", async () => {
    const a = await run();
    const before = money.spentBy(AGENT);
    const failing = async () => { writes++; throw new Error("the node went away"); };
    expect(await attempts.rank(a.id, failing)).toMatchObject({ unwritten: "the node went away", paid: PRICE.rank });
    expect(wireAttempt(attempts.get(a.id)!).ranked).toEqual({ tx: null });

    expect(await attempts.rank(a.id, write)).toMatchObject({ ranked: "memory:1", paid: 0n });
    expect(money.spentBy(AGENT) - before).toBe(PRICE.rank);   // charged exactly once
    expect(ledger.entriesOf(ID)).toHaveLength(1);
  });

  test("two requests at once charge once and write once", async () => {
    const a = await run();
    const before = money.spentBy(AGENT);
    await Promise.all([attempts.rank(a.id, write), attempts.rank(a.id, write), attempts.rank(a.id, write)]);
    expect(money.spentBy(AGENT) - before).toBe(PRICE.rank);
    expect(writes).toBe(1);
  });

  test("an allowance too small to rank is a refusal, and leaves the run solved", async () => {
    const a = await run();
    money.grant(AGENT, money.spentBy(AGENT) + usdc("0.10"));
    expect(await attempts.rank(a.id, write)).toMatchObject({ refused: "allowance", wanted: PRICE.rank });
    expect(attempts.get(a.id)!.outcome).toBe("solved");
    expect(attempts.get(a.id)!.rank).toBe(null);
  });
});

describe("the entry can be checked against the run it names", () => {
  test("its hash is keccak256 of the public record, which ranking does not change", async () => {
    const a = await run();
    const hashBefore = recordHash(a);
    await attempts.rank(a.id, write);
    const after = attempts.get(a.id)!;
    expect(ledger.entriesOf(ID)[0]!.hash).toBe(hashBefore);
    expect(recordHash(after)).toBe(hashBefore);
    // What a stranger would do: take the served record, drop `ranked`, hash the JSON.
    const { ranked: _ranked, ...served } = JSON.parse(JSON.stringify(wireAttempt(after))) as Record<string, unknown>;
    expect(keccak256(stringToBytes(JSON.stringify(served)))).toBe(hashBefore);
    expect(served).toEqual(JSON.parse(JSON.stringify(wireRecord(after))));
  });
});
