import { describe, expect, test } from "vitest";
import { bestByExercise } from "../../src/yours/best.ts";
import { nextFor } from "../../src/yours/next.ts";
import { placeOf } from "../../src/yours/place.ts";
import { shareLeft } from "../../src/yours/OwnerAgent.tsx";
import type { StandingsWire } from "../../../src/shared/wire.ts";

const run = (problem: string, spend: string, probes: number, over: { solved?: boolean; ranked?: boolean } = {}) =>
  ({ problem, spend, probes, solved: over.solved ?? true, ranked: over.ranked ?? false });

describe("an agent's best on each exercise", () => {
  test("is its cheapest solve", () => {
    const best = bestByExercise([run("liar", "0.400000", 20), run("liar", "0.280000", 14), run("liar", "0.300000", 15)]);
    expect(best.get("liar")!.run.spend).toBe("0.280000");
  });

  test("at the same cost, the one with fewer questions, whichever came first", () => {
    const fewer = run("toll", "0.070000", 1), more = run("toll", "0.070000", 3);
    expect(bestByExercise([more, fewer]).get("toll")!.run).toBe(fewer);
    expect(bestByExercise([fewer, more]).get("toll")!.run).toBe(fewer);
  });

  test("a run that was not solved is nobody's best, however little it cost", () => {
    const best = bestByExercise([run("liar", "0.020000", 1, { solved: false }), run("liar", "0.280000", 14)]);
    expect(best.get("liar")!.run.spend).toBe("0.280000");
    expect(bestByExercise([run("toll", "0.020000", 1, { solved: false })]).has("toll")).toBe(false);
  });

  /** Rep is for the exercise, whichever run earned it: the recorded one need not be the cheapest. */
  test("an exercise is recorded if any solve of it was, before or after the best one", () => {
    expect(bestByExercise([run("liar", "0.400000", 20, { ranked: true }), run("liar", "0.280000", 14)]).get("liar")!.recorded).toBe(true);
    expect(bestByExercise([run("liar", "0.280000", 14), run("liar", "0.400000", 20, { ranked: true })]).get("liar")!.recorded).toBe(true);
    expect(bestByExercise([run("liar", "0.280000", 14)]).get("liar")!.recorded).toBe(false);
  });

  test("each exercise has its own", () => {
    const best = bestByExercise([run("liar", "0.280000", 14), run("toll", "0.020000", 1)]);
    expect([...best.keys()].sort()).toEqual(["liar", "toll"]);
  });

  /** Money is compared as money: as text, "0.100000" would sort under "0.020000" only by luck of the digits. */
  test("costs are compared as amounts, not as text", () => {
    expect(bestByExercise([run("liar", "0.090000", 4), run("liar", "0.100000", 5)]).get("liar")!.run.spend).toBe("0.090000");
    expect(bestByExercise([run("liar", "10.000000", 4), run("liar", "9.000000", 5)]).get("liar")!.run.spend).toBe("9.000000");
  });
});

describe("what an owner might do next", () => {
  const ALL = ["toll", "liar"];
  const agent = (over: Partial<Parameters<typeof nextFor>[0]> = {}) =>
    ({ current: true, repUnread: false, ranked: [] as string[], runs: [{}] as never[], ...over });

  test("an agent that has never played is to be started", () => {
    expect(nextFor(agent({ runs: [] }), ALL)).toEqual({ kind: "start" });
  });

  test("one that has played and recorded nothing is to record", () => {
    expect(nextFor(agent(), ALL)).toEqual({ kind: "record" });
  });

  test("one with some recorded is told which are left, in the order given", () => {
    expect(nextFor(agent({ ranked: ["liar"] }), ALL)).toEqual({ kind: "more", left: ["toll"] });
    expect(nextFor(agent({ ranked: ["toll"] }), ["toll", "bisect", "liar"])).toEqual({ kind: "more", left: ["bisect", "liar"] });
  });

  test("one with every exercise recorded has nothing left to record", () => {
    expect(nextFor(agent({ ranked: ["liar", "toll"] }), ALL)).toEqual({ kind: "all" });
  });

  /** Before the list of exercises arrives there are none to be left, and that is not "all of them". */
  test("until the gym's exercises are known, nobody is said to have recorded them all", () => {
    expect(nextFor(agent({ ranked: ["liar"] }), [])).toEqual({ kind: "nothing" });
  });

  test("an exercise the gym no longer serves does not count as one of them", () => {
    expect(nextFor(agent({ ranked: ["chess", "toll"] }), ALL)).toEqual({ kind: "more", left: ["liar"] });
  });

  test("nothing is suggested for an agent the wallet does not grant to, or whose rep was not read", () => {
    expect(nextFor(agent({ current: false, ranked: ["liar"] }), ALL)).toEqual({ kind: "nothing" });
    expect(nextFor(agent({ repUnread: true }), ALL)).toEqual({ kind: "nothing" });
  });
});

describe("where an agent stands", () => {
  const row = (identity: string, holds: string[] = []) => ({ identity, rep: 1, ranked: ["toll"], holds, runs: 1, lastRunAt: 1 });
  const table = (more = 0): StandingsWire => ({ agents: [row("5"), row("7", ["toll", "liar"])], best: [], more });

  test("its place among the ones the gym lists, out of all there are, with the records it holds", () => {
    expect(placeOf(table(), "7", true)).toEqual({ kind: "placed", place: 2, of: 2, holds: 2 });
    expect(placeOf(table(40), "5", true)).toEqual({ kind: "placed", place: 1, of: 42, holds: 0 });
  });

  /** Loading, or a gym that would not say, is not an agent with no place. */
  test("standings that have not been read say nothing about it", () => {
    expect(placeOf(undefined, "7", true)).toEqual({ kind: "unread" });
    expect(placeOf(undefined, null, false)).toEqual({ kind: "unread" });
  });

  test("an agent with nothing recorded is not on them", () => {
    expect(placeOf(table(), "9", false)).toEqual({ kind: "absent" });
    expect(placeOf(table(40), "9", false)).toEqual({ kind: "absent" });
    expect(placeOf(table(), null, false)).toEqual({ kind: "absent" });
  });

  test("one that has recorded, and is not among those listed, is past them when the gym says there are more", () => {
    expect(placeOf(table(40), "9", true)).toEqual({ kind: "past", listed: 2 });
  });

  /** The registry says it recorded and the gym lists everyone: it is not there, and nobody is hidden for it to be among. */
  test("one the registry says recorded, missing from a list that is whole, is not given a place it does not have", () => {
    expect(placeOf(table(0), "9", true)).toEqual({ kind: "absent" });
  });
});

describe("how much of an allowance is left, as a share of the bar", () => {
  test("what is left over the limit", () => {
    expect(shareLeft("3.745000", "5.000000")).toBe(74.9);
    expect(shareLeft("0.000000", "5.000000")).toBe(0);
    expect(shareLeft("5.000000", "5.000000")).toBe(100);
  });

  test("an allowance with no limit has no share to draw", () => {
    expect(shareLeft("0.000000", "0.000000")).toBeNull();
    expect(shareLeft("1.000000", "0.000000")).toBeNull();
  });

  /** A reading taken between a top-up and its limit could say more is left than the limit: the bar is full, not past its end. */
  test("more left than the limit is a full bar, not one that overflows", () => {
    expect(shareLeft("7.000000", "5.000000")).toBe(100);
  });
});
