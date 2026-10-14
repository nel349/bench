import { describe, expect, test, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "../strings.tsx";
import { MAINNET, NETWORKS, TESTNET, on } from "../network.ts";
import type { Network } from "../../src/shared/network/network.ts";
import type { AgentRecordWire, ChainRatingWire, ProblemWire } from "../../../src/shared/wire.ts";
import { RepResult } from "../../src/rep/RepResult.tsx";

const SCRIBE = "0x893E38EDEcbE400Ee8fB1577C6dE3876Cb4973de";
const AGENT = "0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce";
const PRICES = { ask: "0.020000", submit: "0.050000", rank: "0.250000" };
const PROBLEMS: ProblemWire[] = [
  { id: "toll", title: "Toll", category: "c", level: "easy", summary: "s", par: 1, prices: PRICES },
  { id: "liar", title: "Liar", category: "c", level: "hard", summary: "s", par: 14, prices: PRICES },
];
const rating = (over: Partial<ChainRatingWire> = {}): ChainRatingWire =>
  ({ agent: "2419", rating: 1, ranked: ["toll"], scribe: SCRIBE, source: "erc-8004", exists: true, ...over });

/** The server, scripted: each path answers what the real one would. Nothing here reaches one. */
function serving(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const body = routes[String(input)];
    if (body === undefined) return new Response(JSON.stringify({ error: "not here" }), { status: 404 });
    if (body === 500) return new Response(JSON.stringify({ error: "down" }), { status: 500 });
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

function show(looking: string, network: Network = TESTNET) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queries}><RepResult looking={looking} /></QueryClientProvider>, { network });
}

beforeEach(() => { vi.restoreAllMocks(); });

describe("one agent's rep", () => {
  test("nothing looked up shows nothing, and asks the gym for no one", () => {
    const fetch = serving({ "/problems": PROBLEMS });
    vi.stubGlobal("fetch", fetch);
    const { container } = show("");
    expect(container.querySelector(".state, .rep-result")).toBeNull();
    expect(fetch.mock.calls.map(([url]) => String(url)).filter((url) => url !== "/problems")).toEqual([]);
  });

  test.each(NETWORKS)("on %s, the recording key and the registry link to that network's explorer", async (_name, network) => {
    vi.stubGlobal("fetch", serving({ "/problems": PROBLEMS, "/rating/2419": rating() }));
    show("2419", network);
    expect(await screen.findByRole("link", { name: "0x893E…73de" })).toHaveAttribute("href", `${network.explorer}/address/${SCRIBE}`);
    expect(screen.getByRole("link", { name: /^0x8004/ })).toHaveAttribute("href", `${network.explorer}/address/${network.registry}`);
  });

  test("where the gym names no registry, the check says whose key counts and names no registry", async () => {
    vi.stubGlobal("fetch", serving({ "/problems": PROBLEMS, "/rating/2419": rating() }));
    show("2419", on(MAINNET, { registry: null }));
    expect(await screen.findByText(/counting only what Bench's own recording key/)).toBeInTheDocument();
    expect(screen.queryByText(/readAllFeedback/)).not.toBeInTheDocument();
  });

  test("an agent with no recorded solve is told what recording costs and does", async () => {
    vi.stubGlobal("fetch", serving({ "/problems": PROBLEMS, "/rating/2419": rating({ rating: 0, ranked: [] }) }));
    show("2419");
    expect(await screen.findByText(/agent #2419 has no recorded solves yet\. recording a solved run, for \$0\.25/i)).toBeInTheDocument();
    expect(screen.getByText("/ 4 rep")).toBeInTheDocument();
  });

  /** Unknown is neither a number nobody holds nor an agent with nothing: it draws the figure, as the gate would read it. */
  test("a registry that could not say whether anyone holds the number still shows the figure", async () => {
    vi.stubGlobal("fetch", serving({ "/problems": PROBLEMS, "/rating/2419": rating({ exists: null }) }));
    show("2419");
    expect(await screen.findByText("/ 4 rep")).toBeInTheDocument();
    expect(screen.queryByText(/there is no agent/i)).not.toBeInTheDocument();
  });

  /** The rating is asked for twice before it is given up on, about a second apart: see `useChainRating`. */
  test("a registry that would not answer is said to be down, not empty", async () => {
    const fetch = serving({ "/problems": PROBLEMS, "/rating/2419": 500 });
    vi.stubGlobal("fetch", fetch);
    show("2419");
    expect(await screen.findByText(/the registry could not be read just now/i, undefined, { timeout: 4_000 })).toBeInTheDocument();
    expect(fetch.mock.calls.filter(([url]) => String(url) === "/rating/2419")).toHaveLength(2);
    expect(screen.queryByText(/no reputation registry/i)).not.toBeInTheDocument();
  });

  test("an address that has paid for nothing says so, by its short form", async () => {
    const record: AgentRecordWire = { agent: AGENT, spend: "0.000000", attempts: 0, solved: 0, refused: 0, runs: [] };
    vi.stubGlobal("fetch", serving({ "/problems": PROBLEMS, [`/agents/${AGENT}`]: record }));
    show(AGENT);
    expect(await screen.findByText("No run has been paid for by 0x3535…61Ce here yet.")).toBeInTheDocument();
    expect(screen.queryByText("Runs paid for")).not.toBeInTheDocument();
  });

  test("an address's runs are counted: paid for, solved, ran out", async () => {
    const record: AgentRecordWire = { agent: AGENT, spend: "0.230000", attempts: 4, solved: 3, refused: 1, runs: [] };
    vi.stubGlobal("fetch", serving({ "/problems": PROBLEMS, [`/agents/${AGENT}`]: record }));
    show(AGENT);
    expect((await screen.findByText("Runs paid for")).nextSibling).toHaveTextContent("4");
    expect(screen.getByText("Solved").nextSibling).toHaveTextContent("3");
    expect(screen.getByText("Ran out").nextSibling).toHaveTextContent("1");
  });
});
