import { expect, test, describe } from "bun:test";
import { standings } from "../../src/gym/standings.ts";
import type { Attempt } from "../../src/gym/attempt.ts";
import { usdc } from "../../src/shared/money.ts";
import "../../src/problems/blackbox.ts";
import "../../src/problems/zendo.ts";
import "../../src/problems/toll.ts";
import "../../src/problems/bisect.ts";

let made = 0;

/**
 * A run as the store keeps it. Solved, paid for and ranked under a proven identity unless said
 * otherwise. `rankedAt` is when its record was written, which is the time every ordering here uses.
 */
function run(over: Partial<Attempt> & { readonly asked?: number; readonly rankedAt?: number }): Attempt {
  const { asked = 1, rankedAt, ...rest } = over;
  made += 1;
  return {
    id: `a${made}`, agent: "anonymous", payer: "0x00000000000000000000000000000000000000aa",
    claimedId: "1", identity: "1", problem: "toll", seed: "seed",
    startedAt: 1_000, endedAt: 2_000, outcome: "solved",
    probes: Array.from({ length: asked }, () => ({ question: null, answer: null })),
    submissions: 1, spend: usdc("0.10"), budget: null, state: null,
    rank: rankedAt === undefined ? { tx: "0xabc" } : { tx: "0xabc", at: rankedAt },
    ...rest,
  };
}

const places = (attempts: readonly Attempt[]) => standings(attempts).agents.map((a) => a.identity);
const holder = (attempts: readonly Attempt[], problem: string) =>
  standings(attempts).best.find((b) => b.problem === problem)?.identity;

describe("who is on the table", () => {
  test("an agent with a ranked solve, with its rep, what it ranked and its runs", () => {
    const table = standings([
      run({ identity: "7", problem: "zendo", outcome: "refused", rank: null, startedAt: 50 }),
      run({ identity: "7", problem: "blackbox", startedAt: 30, rankedAt: 40 }),
      run({ identity: "7", problem: "toll", startedAt: 10, rankedAt: 20 }),
    ]);
    // What it ranked is in the order it ranked them, and its last run is the latest, wherever the store has them.
    expect(table.agents).toEqual([
      { identity: "7", rep: 4, ranked: ["toll", "blackbox"], holds: ["toll", "blackbox"], runs: 3, lastRunAt: 50 },
    ]);
  });

  test("a solve that was not ranked puts nobody on it, however cheap", () => {
    expect(standings([run({ identity: "7", rank: null, spend: usdc("0.02") })]).agents).toEqual([]);
  });

  test("nor does one whose record was paid for and never written", () => {
    expect(standings([run({ identity: "7", rank: { tx: null } })]).agents).toEqual([]);
  });

  test("nor a ranked run that is not solved, nor one with no proven identity", () => {
    expect(standings([run({ identity: "7", outcome: "refused" }), run({ identity: null })]).agents).toEqual([]);
  });

  test("the same problem ranked twice is one problem", () => {
    const [agent] = standings([run({ identity: "7" }), run({ identity: "7" })]).agents;
    expect(agent!.rep).toBe(1);
    expect(agent!.ranked).toEqual(["toll"]);
  });

  test("runs nobody paid for, and another agent's, are not its runs", () => {
    const [agent] = standings([
      run({ identity: "7" }),
      run({ identity: "7", payer: null, rank: null, outcome: "open" }),
      run({ identity: "8", rank: null }),
    ]).agents;
    expect(agent!.runs).toBe(1);
  });
});

describe("who holds the best solve on a problem", () => {
  test("the cheapest ranked solve", () => {
    expect(holder([run({ identity: "7", spend: usdc("0.10") }), run({ identity: "8", spend: usdc("0.08") })], "toll")).toBe("8");
  });

  test("a cheaper solve that was not ranked does not take it", () => {
    expect(holder([run({ identity: "7", spend: usdc("0.10") }), run({ identity: "8", spend: usdc("0.02"), rank: null })], "toll")).toBe("7");
  });

  test("at the same cost, the one with fewer questions", () => {
    expect(holder([run({ identity: "7", asked: 5 }), run({ identity: "8", asked: 4 })], "toll")).toBe("8");
  });

  test("matching it is not beating it: at the same cost and questions, the earlier solve keeps it", () => {
    const earlier = run({ identity: "7", rankedAt: 100 });
    const later = run({ identity: "8", rankedAt: 200 });
    expect(holder([earlier, later], "toll")).toBe("7");
    expect(holder([later, earlier], "toll")).toBe("7");
  });

  /**
   * A run can be ranked long after it was solved. Going by when it was solved, an agent could keep an
   * old solve unranked, wait for another to rank an equal one, and then rank its own to take the best.
   */
  test("first means ranked first: an older solve ranked later does not take it", () => {
    const sleeper = run({ identity: "7", startedAt: 10, endedAt: 10, rankedAt: 900 });
    const holder_ = run({ identity: "8", startedAt: 500, endedAt: 500, rankedAt: 600 });
    expect(holder([sleeper, holder_], "toll")).toBe("8");
    expect(holder([holder_, sleeper], "toll")).toBe("8");
  });

  test("a record written before its time was kept goes by when it was solved", () => {
    const old = run({ identity: "7", endedAt: 100 });
    const newer = run({ identity: "8", endedAt: 50, rankedAt: 200 });
    expect(holder([newer, old], "toll")).toBe("7");
  });

  test("ranked in the same moment too, the one the record has first keeps it", () => {
    const first = run({ identity: "7", rankedAt: 100 });
    const second = run({ identity: "8", rankedAt: 100 });
    expect(holder([first, second], "toll")).toBe("7");
    expect(holder([second, first], "toll")).toBe("8");
  });

  test("each problem has its own, and says what it cost", () => {
    const { best } = standings([
      run({ identity: "7", problem: "toll", spend: usdc("0.02"), asked: 1 }),
      run({ identity: "8", problem: "blackbox", spend: usdc("0.14"), asked: 7 }),
    ]);
    expect(best.map((b) => [b.problem, b.identity, b.spend, b.probes.length])).toEqual([
      ["toll", "7", usdc("0.02"), 1], ["blackbox", "8", usdc("0.14"), 7],
    ]);
  });
});

describe("who is ahead", () => {
  test("more rep first", () => {
    expect(places([
      run({ identity: "7", problem: "toll" }),
      run({ identity: "8", problem: "blackbox" }),
    ])).toEqual(["8", "7"]);
  });

  test("level on rep, the one holding more bests", () => {
    // Both have ranked both problems. 8 holds both bests; 7, which got there first, holds neither.
    expect(places([
      run({ identity: "7", problem: "toll", spend: usdc("0.10"), rankedAt: 10 }),
      run({ identity: "7", problem: "bisect", spend: usdc("0.30"), rankedAt: 20 }),
      run({ identity: "8", problem: "toll", spend: usdc("0.02"), rankedAt: 30 }),
      run({ identity: "8", problem: "bisect", spend: usdc("0.24"), rankedAt: 40 }),
    ])).toEqual(["8", "7"]);
  });

  test("more rep is ahead of more bests", () => {
    // 7 holds two bests with 2 rep; 8 holds one with 3.
    expect(places([
      run({ identity: "7", problem: "toll" }),
      run({ identity: "7", problem: "bisect" }),
      run({ identity: "8", problem: "blackbox" }),
    ])).toEqual(["8", "7"]);
  });

  test("level on both, the one that reached its rep first, whichever its number", () => {
    const attempts = [
      run({ identity: "9", problem: "toll", rankedAt: 10 }),
      run({ identity: "3", problem: "bisect", rankedAt: 20 }),
    ];
    expect(places(attempts)).toEqual(["9", "3"]);
    expect(places([...attempts].reverse())).toEqual(["9", "3"]);
  });

  test("reaching it means the last of its problems, and ranking one again later does not move that", () => {
    // 7 finished its two at 30. 8 finished at 40, though it started first. 7 ranking toll again at 99 changes nothing.
    expect(places([
      run({ identity: "8", problem: "toll", spend: usdc("0.02"), rankedAt: 5 }),
      run({ identity: "7", problem: "toll", rankedAt: 10 }),
      run({ identity: "7", problem: "bisect", spend: usdc("0.02"), rankedAt: 30 }),
      run({ identity: "8", problem: "bisect", rankedAt: 40 }),
      run({ identity: "7", problem: "toll", rankedAt: 99 }),
    ])).toEqual(["7", "8"]);
  });

  test("an older solve ranked later does not arrive first", () => {
    expect(places([
      run({ identity: "7", problem: "toll", endedAt: 10, rankedAt: 900 }),
      run({ identity: "8", problem: "bisect", endedAt: 500, rankedAt: 600 }),
    ])).toEqual(["8", "7"]);
  });

  test("with nothing to tell them apart, by number, the same way every time", () => {
    const attempts = [
      run({ identity: "10", problem: "toll", rankedAt: 10 }),
      run({ identity: "9", problem: "bisect", rankedAt: 10 }),
    ];
    expect(places(attempts)).toEqual(["9", "10"]);
    expect(places([...attempts].reverse())).toEqual(["9", "10"]);
  });
});
