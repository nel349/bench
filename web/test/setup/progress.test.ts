import { describe, expect, test } from "vitest";
import { setupProgress } from "../../src/setup/progress.ts";
import type { FundsWire, OwnerAgentWire, OwnerWire } from "../../../src/shared/wire.ts";

const funds = (wallet: string): FundsWire => ({ agent: "0xw", wallet, deposit: "0.000000", ready: false, probes: 0 });
const agent = (over: Partial<OwnerAgentWire>): OwnerAgentWire => ({
  address: "0xa", current: true, identity: null, rep: null, repUnread: false, ranked: [], live: null, runs: [], spend: "0",
  qualifies: [], won: [],
  allowance: { limit: "5.000000", used: "0.000000", remaining: "5.000000", validUntil: 0, live: true }, ...over,
});
const owner = (...agents: OwnerAgentWire[]): OwnerWire => ({ wallet: "0xw", agents, more: 0, partial: false });
const SPENT = { limit: "5.000000", used: "5.000000", remaining: "0.000000", validUntil: 0, live: false };

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

  /** The fixture had no allowance at all, so this passed whether or not `current` was read. */
  test("an agent the wallet no longer grants to does not count as granted, whatever its allowance read", () => {
    expect(setupProgress(funds("0.000000"), owner(agent({ current: false })))).toEqual([false, false, false, false, false]);
  });

  /** An owner whose agent had used its whole $5 was shown steps 2 and 3 as still to do. */
  test("an allowance that ran out or ended was still granted", () => {
    const run = { attempt: "a1" } as OwnerAgentWire["runs"][number];
    expect(setupProgress(funds("0.000000"), owner(agent({ allowance: SPENT, runs: [run] })))).toEqual([true, true, true, true, true]);
    // And one the plugin lists but would not describe.
    expect(setupProgress(funds("0.000000"), owner(agent({ allowance: null })))).toEqual([true, true, true, false, false]);
  });

  test("runs of an agent it no longer grants to do not tick the steps for a new one that has not played", () => {
    const run = { attempt: "a1" } as OwnerAgentWire["runs"][number];
    const old = agent({ address: "0xold", current: false, runs: [run] });
    expect(setupProgress(funds("1.000000"), owner(old, agent({})))).toEqual([true, true, true, false, false]);
  });
});
