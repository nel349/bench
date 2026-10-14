import { describe, expect, test } from "bun:test";
import { otherGymFrom } from "../../src/http/otherGym.ts";

describe("the gym on the other network, as it is named to this one", () => {
  test("none named is none, and so is a blank", () => {
    expect(otherGymFrom(undefined)).toBeNull();
    expect(otherGymFrom("   ")).toBeNull();
  });

  // The page adds the path of whatever it is showing, so a path or a slash here would double up.
  test("only the origin is kept", () => {
    expect(otherGymFrom("https://testnet.bench.test/")).toBe("https://testnet.bench.test");
    expect(otherGymFrom(" https://testnet.bench.test/fund?agent=0x1#gigs ")).toBe("https://testnet.bench.test");
    expect(otherGymFrom("http://localhost:8975")).toBe("http://localhost:8975");
  });

  // Served as written, either would be a switch on every page that goes nowhere, or somewhere worse.
  test("a name that is not an address stops the start, and so does one that is not http", () => {
    expect(() => otherGymFrom("testnet.bench.test")).toThrow("BENCH_OTHER_GYM");
    expect(() => otherGymFrom("javascript:alert(1)")).toThrow("http or https");
  });
});
