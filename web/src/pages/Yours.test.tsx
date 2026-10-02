import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BountyWire, FeedRowWire, OwnerAgentWire, OwnerWire, ProblemWire } from "../../../src/wire.ts";
import { Yours } from "./Yours.tsx";
import { runnerName } from "../lib/runner.ts";
import { outcomeOf } from "../lib/outcome.ts";
import { LIVE_FOR_MS } from "../../../src/live.ts";

const WALLET = "0x9fa928ACfE2eEcEad9698ebBad835E7129688b28";
const AGENT = "0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce";
const PRICES = { ask: "0.020000", submit: "0.050000", rank: "0.250000" };
const PROBLEMS: ProblemWire[] = [
  { id: "liar", title: "Liar", category: "search", level: "hard", par: 14, prices: PRICES },
  { id: "toll", title: "Toll", category: "maze", level: "easy", par: 1, prices: PRICES },
];
const run = (attempt: string, over: Partial<FeedRowWire> = {}): FeedRowWire => ({
  attempt, agent: "anonymous", payer: AGENT, identity: "894767", problem: "liar", seed: null, fingerprint: "0x",
  solved: false, spend: "0.140000", probes: 7, submissions: 0, wallTimeMs: 1, endedBy: "open", ranked: false,
  startedAt: Date.now() - 60_000, ...over,
});
const agent = (over: Partial<OwnerAgentWire> = {}): OwnerAgentWire => ({
  address: AGENT,
  allowance: { limit: "5.000000", used: "1.255000", remaining: "3.745000", validUntil: 1_791_500_983, live: true },
  identity: "894767", rep: 4, ranked: ["liar", "toll"], live: null, runs: [], spend: "1.730000", qualifies: [],
  ...over,
});
const gig: BountyWire = {
  id: "b3", poster: "0xposter", title: "The largest twenty-bit number", statement: "s", amount: "0.100000",
  escrowId: "5", deadline: Date.now() + 3_600_000, minRating: 8, postedAt: 0, solvedBy: null, solvedAt: null,
  awardTx: null, attempts: 0, open: true, awaitingPayout: false,
};

function serving(owner: OwnerWire | 500) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === `/owner/${WALLET}`) {
      return owner === 500 ? new Response("{}", { status: 500 }) : new Response(JSON.stringify(owner), { status: 200 });
    }
    if (url === "/problems") return new Response(JSON.stringify(PROBLEMS), { status: 200 });
    if (url === "/bounties") return new Response(JSON.stringify([gig]), { status: 200 });
    return new Response("{}", { status: 404 });
  });
}

function show(node: React.ReactNode) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queries}>{node}</QueryClientProvider>);
}

beforeEach(() => { vi.restoreAllMocks(); });

describe("the owner's page", () => {
  test("shows each agent: its identity, rep, what is left to spend, and when the allowance ends", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent()] }));
    show(<Yours wallet={WALLET} remember={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Agent #894767" })).toBeInTheDocument();
    expect(screen.getByText("4 / 4")).toBeInTheDocument();
    expect(screen.getByText(/ranked: liar, toll/i)).toBeInTheDocument();
    expect(screen.getByText(/not playing right now/i)).toBeInTheDocument();
  });

  /** The gap this page exists for: after step 4 nothing showed what the agent was doing. */
  test("a run being played shows live, with its questions and what it has cost so far", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ live: run("a20"), runs: [run("a20")] })] }));
    show(<Yours wallet={WALLET} remember={() => {}} />);
    expect(await screen.findByText(/playing liar now: 7 questions/i)).toBeInTheDocument();
  });

  test("names the gigs an agent already qualifies for, and how to enter", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ qualifies: ["b3"] })] }));
    show(<Yours wallet={WALLET} remember={() => {}} />);
    expect(await screen.findByRole("link", { name: gig.title })).toHaveAttribute("href", "#gigs");
    expect(screen.getByText(/tell your agent which gig to take/i)).toBeInTheDocument();
  });

  test("the wallet is remembered once its page has opened", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [] }));
    const remember = vi.fn();
    show(<Yours wallet={WALLET} remember={remember} />);
    await waitFor(() => expect(remember).toHaveBeenCalledWith(WALLET));
  });

  test("a wallet with no agents says so and points to Load", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [] }));
    show(<Yours wallet={WALLET} remember={() => {}} />);
    expect(await screen.findByText(/has not granted an allowance/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /load your agent/i })).toBeInTheDocument();
  });

  test("without a wallet it says where the link comes from, and asks for the address", () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [] }));
    show(<Yours wallet="" remember={() => {}} />);
    expect(screen.getByText(/gives you this page's link when it starts training/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
  });

  test("a read that fails is said, not shown as an empty wallet", async () => {
    vi.stubGlobal("fetch", serving(500));
    show(<Yours wallet={WALLET} remember={() => {}} />);
    expect(await screen.findByText(/could not be read just now/i)).toBeInTheDocument();
    expect(screen.queryByText(/has not granted/i)).not.toBeInTheDocument();
  });
});

describe("who ran it, and how it ended", () => {
  /** Every connector run read "anonymous", though each carried a proven identity. */
  test("an unnamed run is called by its identity; a name the agent chose is kept", () => {
    expect(runnerName({ agent: "anonymous", identity: "894767" })).toBe("agent #894767");
    expect(runnerName({ agent: "anonymous", identity: null })).toBe("anonymous");
    expect(runnerName({ agent: "aria", identity: "894767" })).toBe("aria");
  });

  test("an open run past the hour reads as left open, not in progress", () => {
    const now = 10 * LIVE_FOR_MS;
    expect(outcomeOf({ endedBy: "open", ranked: false, startedAt: now - 60_000 }, now).label).toBe("IN PROGRESS");
    expect(outcomeOf({ endedBy: "open", ranked: false, startedAt: now - 2 * LIVE_FOR_MS }, now).label).toBe("LEFT OPEN");
  });
});
