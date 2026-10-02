import { describe, expect, test } from "vitest";
import { short, since, until } from "../../../src/shared/lib/elapsed.ts";
import { say } from "../../strings.tsx";

const NOW = 1_000_000_000_000;
const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

describe("how long ago, in the roughest unit still true", () => {
  test("seconds, minutes, hours, days", () => {
    expect(say(since(NOW - 5 * S, NOW))).toBe("5s ago");
    expect(say(since(NOW - 3 * M, NOW))).toBe("3m ago");
    expect(say(since(NOW - 2 * H - 59 * M, NOW))).toBe("2h ago");
    expect(say(since(NOW - 4 * D, NOW))).toBe("4d ago");
  });
  test("a clock slightly ahead never reads as the future", () => expect(say(since(NOW + 5 * S, NOW))).toBe("0s ago"));
});

describe("how long is left", () => {
  test("days, then hours, then under an hour, then closed", () => {
    expect(say(until(NOW + 3 * D + H, NOW))).toBe("3d left");
    expect(say(until(NOW + 5 * H, NOW))).toBe("5h left");
    expect(say(until(NOW + 20 * M, NOW))).toBe("under an hour left");
    expect(say(until(NOW, NOW))).toBe("closed");
  });
});

describe("an address, shortened", () => {
  test("keeps the ends that identify it", () => {
    expect(short("0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce")).toBe("0x3535…61Ce");
  });
  test("something already short is left alone", () => expect(short("0xabc")).toBe("0xabc"));
});
