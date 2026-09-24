import { expect, test, describe } from "bun:test";
import { LEVEL_WEIGHT, rate, weigh } from "./rating.ts";
import { Attempts } from "./attempt.ts";
import { InMemoryAllowance } from "./payments.ts";
import { MemoryReputation } from "./reputation.ts";
import { usdc } from "./money.ts";
import { allProblems } from "./problems/problem.ts";
import { boardFrom } from "./problems/blackbox.ts";
import "./problems/blackbox-problem.ts";
import "./problems/zendo.ts";
import "./problems/toll.ts";
import "./problems/bisect.ts";
import "./problems/codebreaker.ts";
import "./problems/ranking.ts";
import "./problems/liar.ts";

const AGENT = "agent:aria";
const ID = 42n;

describe("the rating is distinct problems, weighted by level", () => {
  test("easy counts 1, medium 2, hard 3", () => {
    expect(weigh(["toll"])).toBe(1);
    expect(weigh(["zendo"])).toBe(2);
    expect(weigh(["blackbox"])).toBe(3);
  });
  test("a problem counts once however often it appears", () => {
    expect(weigh(["blackbox", "blackbox", "blackbox"])).toBe(3);
  });
  test("a problem this gym does not serve counts nothing", () => {
    expect(weigh(["chess", "blackbox"])).toBe(3);
  });
  test("all seven make fourteen, and grinding the easy ones cannot reach what one hard one does", () => {
    expect(weigh(allProblems().map((p) => p.id))).toBe(14);
    const easy = allProblems().filter((p) => p.level === "easy").map((p) => p.id);
    expect(weigh(easy)).toBeLessThan(LEVEL_WEIGHT.hard);
  });
});

/** A run solved and paid for under a proven identity: the only kind that can be ranked. */
async function solvedRun(attempts: Attempts, seed: string) {
  const a = attempts.start(AGENT, "blackbox", seed, null, ID)!;
  await attempts.ask(a.id, { side: "up", index: 0 });
  await attempts.submit(a.id, boardFrom(seed).atoms);
  return attempts.get(a.id)!;
}

describe("our own record counts ranked runs only, for the address that paid", () => {
  const setup = () => {
    const money = new InMemoryAllowance();
    money.grant(AGENT, usdc("5"));
    const attempts = new Attempts(money, undefined, async (id, payer) => id === ID && payer === AGENT);
    return { attempts, ledger: new MemoryReputation() };
  };

  test("a solve that is not ranked counts nothing yet", async () => {
    const { attempts } = setup();
    const a = await solvedRun(attempts, "1");
    expect(a.outcome).toBe("solved");
    expect(rate(attempts.all(), AGENT).rating).toBe(0);
  });

  test("once ranked it counts its level, here and in the ledger alike", async () => {
    const { attempts, ledger } = setup();
    const a = await solvedRun(attempts, "1");
    await attempts.rank(a.id, (run, agentId) => ledger.write({
      agentId, problem: run.problem, cost: run.spend, endpoint: "e", uri: "u", hash: "0x00" }));
    expect(rate(attempts.all(), AGENT).rating).toBe(3);
    expect(weigh(await ledger.ranked(ID))).toBe(3);
  });

  test("ranking the same problem again adds nothing", async () => {
    const { attempts, ledger } = setup();
    for (const seed of ["1", "2", "3"]) {
      const a = await solvedRun(attempts, seed);
      await attempts.rank(a.id, (run, agentId) => ledger.write({
        agentId, problem: run.problem, cost: run.spend, endpoint: "e", uri: "u", hash: "0x00" }));
    }
    expect(ledger.entriesOf(ID)).toHaveLength(3);
    expect(weigh(await ledger.ranked(ID))).toBe(3);
    expect(rate(attempts.all(), AGENT).rating).toBe(3);
  });

  test("a name in a header finds nothing; the address that paid finds it all", async () => {
    const { attempts, ledger } = setup();
    const a = await solvedRun(attempts, "1");
    await attempts.rank(a.id, (run, agentId) => ledger.write({
      agentId, problem: run.problem, cost: run.spend, endpoint: "e", uri: "u", hash: "0x00" }));
    expect(rate(attempts.all(), "0xsomeone-else").rating).toBe(0);
    expect(rate(attempts.all(), AGENT).solved).toBe(1);
  });
});
