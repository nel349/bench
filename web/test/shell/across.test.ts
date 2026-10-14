import { describe, expect, test } from "vitest";
import { acrossHref } from "../../src/shell/across.ts";

const OTHER = "https://testnet.bench.example";
const at = (pathname: string, hash = "") => ({ pathname, hash });

describe("the same page on the other network's gym", () => {
  test("the front page goes to the front page", () => {
    expect(acrossHref(OTHER, at("/"))).toBe(`${OTHER}/`);
    expect(acrossHref(OTHER, at("/", "#home"))).toBe(`${OTHER}/`);
  });

  test("Start goes to Start, without the agent its link named", () => {
    expect(acrossHref(OTHER, at("/fund"))).toBe(`${OTHER}/fund`);
  });

  test("a view goes to the same view", () => {
    expect(acrossHref(OTHER, at("/", "#standings"))).toBe(`${OTHER}/#standings`);
    expect(acrossHref(OTHER, at("/", "#gigs"))).toBe(`${OTHER}/#gigs`);
  });

  // An agent's number, a wallet's address and an exercise's own page belong to one network.
  test("what follows the view is left behind", () => {
    expect(acrossHref(OTHER, at("/", "#standings/894767"))).toBe(`${OTHER}/#standings`);
    expect(acrossHref(OTHER, at("/", "#yours/0x9fa928ACfE2eEcEad9698ebBad835E7129688b28"))).toBe(`${OTHER}/#yours`);
    expect(acrossHref(OTHER, at("/", "#exercises/toll"))).toBe(`${OTHER}/#exercises`);
  });

  test("the wallet's answer to Connect is not carried: it was an answer to this gym", () => {
    expect(acrossHref(OTHER, at("/", "#connected/0x9fa928ACfE2eEcEad9698ebBad835E7129688b28"))).toBe(`${OTHER}/`);
  });

  test("a view under its former name goes to what it became", () => {
    expect(acrossHref(OTHER, at("/", "#ledger/894767"))).toBe(`${OTHER}/#standings`);
  });
});
