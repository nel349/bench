import { describe, expect, test } from "vitest";
import type { ProblemWire } from "../../../src/shared/wire.ts";
import { recordStanding } from "../../src/train/record.ts";
import { byLevel } from "../../src/train/order.ts";

describe("where a record stands against the fewest questions an exercise needs", () => {
  const ASK = "0.020000";

  test("an exercise nobody has recorded has no record", () => {
    expect(recordStanding(4, ASK, undefined)).toBe("none");
    expect(recordStanding(null, ASK, undefined)).toBe("none");
  });

  /** A number here would be read as a floor, and nobody has proven one. */
  test("where no fewest is proven there is nothing to measure a record against", () => {
    expect(recordStanding(null, ASK, { spend: "0.240000" })).toBe("unproven");
  });

  test("a record that cost more than the fewest questions do can be beaten by skill alone", () => {
    // Codebreaker: four questions always suffice, $0.08, and the record took five.
    expect(recordStanding(4, ASK, { spend: "0.100000" })).toBe("above");
    expect(recordStanding(4, ASK, { spend: "0.080001" })).toBe("above");
  });

  test("one that cost exactly what they do matches it", () => {
    expect(recordStanding(4, ASK, { spend: "0.080000" })).toBe("at");
    expect(recordStanding(1, ASK, { spend: "0.020000" })).toBe("at");
  });

  /** The fewest needed is what a method can promise. A run the hidden answer was kind to can come in under it. */
  test("one that cost less was a lucky run, and is said to have beaten it", () => {
    expect(recordStanding(16, ASK, { spend: "0.300000" })).toBe("under");
  });

  /** It is the cost that is compared: the right number of questions and a paid second answer is above. */
  test("the fewest questions and something paid on top is still above", () => {
    expect(recordStanding(4, ASK, { spend: "0.130000" })).toBe("above");
  });
});

describe("the order an owner reads the exercises in", () => {
  const p = (id: string, level: ProblemWire["level"]) => ({ id, level });

  test("easiest first, and within a level the order the gym lists them", () => {
    const gym = [p("blackbox", "hard"), p("zendo", "medium"), p("toll", "easy"), p("bisect", "easy"),
                 p("codebreaker", "medium"), p("ranking", "medium"), p("liar", "hard")];
    expect(byLevel(gym).map((x) => x.id)).toEqual(["toll", "bisect", "zendo", "codebreaker", "ranking", "blackbox", "liar"]);
  });

  test("the list it was given is left as it was", () => {
    const gym = [p("liar", "hard"), p("toll", "easy")];
    byLevel(gym);
    expect(gym.map((x) => x.id)).toEqual(["liar", "toll"]);
  });
});
