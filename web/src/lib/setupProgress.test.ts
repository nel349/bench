import { describe, expect, test } from "vitest";
import { setupProgress } from "./setupProgress.ts";
import type { FundsWire, OwnerAgentWire, OwnerWire } from "../../../src/wire.ts";

const funds = (wallet: string): FundsWire => ({ agent: "0xw", wallet, deposit: "0.000000", ready: false, probes: 0 });
const agent = (over: Partial<OwnerAgentWire>): OwnerAgentWire => ({
  address: "0xa", current: true, identity: null, rep: null, ranked: [], live: null, runs: [], spend: "0", qualifies: [], won: [],
  allowance: { limit: "5.000000", used: "0.000000", remaining: "5.000000", validUntil: 0, live: true }, ...over,
});
const owner = (...agents: OwnerAgentWire[]): OwnerWire => ({ wallet: "0xw", agents });

describe("Set up, ticked from what the chain says", () => {
  test("nothing done: an empty wallet with no agents", () => {
    expect(setupProgress(funds("0.000000"), owner())).toEqual([false, false, false, false, false]);
  });

  test("a wallet with money has done step 1", () => {
    expect(setupProgress(funds("19.970000"), owner())).toEqual([true, false, false, false, false]);
  });

  /** An allowance can only be granted to a pairing code, which only the connector shows. */
  test("a live allowance means the agent was connected and granted to", () => {
    expect(setupProgress(funds("19.970000"), owner(agent({})))).toEqual([true, true, true, false, false]);
  });

  test("a run means it was told to play, and there is something to watch", () => {
    const run = { attempt: "a1" } as OwnerAgentWire["runs"][number];
    expect(setupProgress(funds("19.970000"), owner(agent({ runs: [run] })))).toEqual([true, true, true, true, true]);
  });

  test("a revoked agent's allowance does not count as granted", () => {
    expect(setupProgress(funds("1.000000"), owner(agent({ current: false, allowance: null })))[2]).toBe(false);
  });
});
