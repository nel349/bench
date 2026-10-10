import { describe, expect, test } from "vitest";
import { routeOf } from "../../src/shell/useView.ts";

describe("reading the hash", () => {
  test("a view alone", () => expect(routeOf("#gigs")).toEqual({ view: "gigs", detail: [] }));
  test("a view and its detail", () => {
    expect(routeOf("#rig/liar")).toEqual({ view: "rig", detail: ["liar"] });
    expect(routeOf("#rig/blackbox/board")).toEqual({ view: "rig", detail: ["blackbox", "board"] });
    expect(routeOf("#ledger/894767")).toEqual({ view: "ledger", detail: ["894767"] });
  });
  /** `/#%` is not valid percent-encoding, and reading it threw, which blanked the page. */
  test("a hash that cannot be decoded is the front page, not a crash", () => {
    expect(routeOf("#%")).toEqual({ view: "home", detail: [] });
    expect(routeOf("#yours/%E0%A4%A")).toEqual({ view: "yours", detail: ["%E0%A4%A"] });
  });

  test("an owner's page and a return from the wallet carry their address", () => {
    expect(routeOf("#yours/0xabc")).toEqual({ view: "yours", detail: ["0xabc"] });
    expect(routeOf("#connected/0xabc")).toEqual({ view: "connected", detail: ["0xabc"] });
    expect(routeOf("#connected/")).toEqual({ view: "connected", detail: [] });
  });

  test("nothing, or nonsense, is the front page", () => {
    expect(routeOf("")).toEqual({ view: "home", detail: [] });
    expect(routeOf("#nowhere/liar")).toEqual({ view: "home", detail: [] });
  });
});
