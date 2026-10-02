import { describe, expect, test } from "vitest";
import { whoIs } from "../../src/rep/who.ts";
import { parCost } from "../../src/train/par.ts";
import { intl } from "../strings.tsx";

describe("reading what was typed into the rep lookup", () => {
  test("digits are an ERC-8004 id", () => expect(whoIs(" 894767 ")).toEqual({ kind: "identity", id: "894767" }));
  test("0x and forty hex digits are an address", () => {
    const a = "0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce";
    expect(whoIs(a)).toEqual({ kind: "address", address: a });
  });
  test("zero, a name, or a short address is neither", () => {
    for (const t of ["0", "agent:aria", "0x3535", "", "12a"]) expect(whoIs(t).kind).toBe("neither");
  });
});

describe("what the fewest questions cost", () => {
  test("the fewest questions at the question price, exactly", () => {
    expect(parCost(16, "0.020000")).toBe("0.320000");
    expect(parCost(1, "0.020000")).toBe("0.020000");
    expect(parCost(14, "0.020000")).toBe("0.280000");
  });
  test("no proven fewest, no number", () => expect(parCost(null, "0.020000")).toBe(null));
});

describe("a count of questions", () => {
  const questions = (count: number) => intl.formatMessage({ id: "count.questions" }, { count });
  test("one is singular", () => expect(questions(1)).toBe("1 question"));
  test("more are plural, and so is none", () => {
    expect(questions(14)).toBe("14 questions");
    expect(questions(0)).toBe("0 questions");
  });
});
