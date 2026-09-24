import { describe, expect, test } from "vitest";
import { routeOf } from "./useView.ts";

describe("reading the hash", () => {
  test("a view alone", () => expect(routeOf("#gigs")).toEqual({ view: "gigs", detail: [] }));
  test("a view and its detail", () => {
    expect(routeOf("#rig/liar")).toEqual({ view: "rig", detail: ["liar"] });
    expect(routeOf("#rig/blackbox/board")).toEqual({ view: "rig", detail: ["blackbox", "board"] });
    expect(routeOf("#ledger/894767")).toEqual({ view: "ledger", detail: ["894767"] });
  });
  test("nothing, or nonsense, is the rig with nothing chosen", () => {
    expect(routeOf("")).toEqual({ view: "rig", detail: [] });
    expect(routeOf("#nowhere/liar")).toEqual({ view: "rig", detail: [] });
  });
});
