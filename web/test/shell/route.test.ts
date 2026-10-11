import { describe, expect, test } from "vitest";
import { renamed, routeOf } from "../../src/shell/useView.ts";

describe("reading the hash", () => {
  test("a view alone", () => expect(routeOf("#gigs")).toEqual({ view: "gigs", detail: [] }));
  test("a view and its detail", () => {
    expect(routeOf("#exercises/liar")).toEqual({ view: "exercises", detail: ["liar"] });
    expect(routeOf("#exercises/blackbox/demo")).toEqual({ view: "exercises", detail: ["blackbox", "demo"] });
    expect(routeOf("#standings/894767")).toEqual({ view: "standings", detail: ["894767"] });
  });
  /** Agents gave these out, and people kept them, while the views were called by the gym's own names. */
  test("a link under a view's former name opens the view it became, with its detail", () => {
    expect(routeOf("#rig")).toEqual({ view: "exercises", detail: [] });
    expect(routeOf("#rig/liar")).toEqual({ view: "exercises", detail: ["liar"] });
    expect(routeOf("#rig/blackbox/board")).toEqual({ view: "exercises", detail: ["blackbox", "board"] });
    expect(routeOf("#ledger/894767")).toEqual({ view: "standings", detail: ["894767"] });
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

  /** So the address bar is put right, and the present name is what gets copied from here on. */
  test("a hash under a former name says what it should now read; any other says nothing", () => {
    expect(renamed("#rig")).toBe("/#exercises");
    expect(renamed("#rig/liar")).toBe("/#exercises/liar");
    expect(renamed("#ledger/894767")).toBe("/#standings/894767");
    expect(renamed("#exercises/liar")).toBeNull();
    expect(renamed("#yours/0xabc")).toBeNull();
    expect(renamed("")).toBeNull();
    expect(renamed("#nowhere")).toBeNull();
    expect(renamed("#constructor")).toBeNull();
  });

  test("nothing, or nonsense, is the front page", () => {
    expect(routeOf("")).toEqual({ view: "home", detail: [] });
    expect(routeOf("#nowhere/liar")).toEqual({ view: "home", detail: [] });
  });
});
