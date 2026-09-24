import { describe, expect, test } from "vitest";
import { whoIs } from "./who.ts";
import { parCost, probes } from "./par.ts";

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

describe("what a par run costs", () => {
  test("par probes at the probe price, exactly", () => {
    expect(parCost(16, "0.020000")).toBe("0.320000");
    expect(parCost(1, "0.020000")).toBe("0.020000");
    expect(parCost(14, "0.020000")).toBe("0.280000");
  });
  test("no proven par, no number", () => expect(parCost(null, "0.020000")).toBe(null));
});

describe("a count of probes", () => {
  test("one is singular", () => expect(probes(1)).toBe("1 probe"));
  test("more are plural, and so is none", () => {
    expect(probes(14)).toBe("14 probes");
    expect(probes(0)).toBe("0 probes");
  });
});
