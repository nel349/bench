import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  AgentRecordWire, BountyWire, ChainRatingWire, ProblemDetailWire, ProblemWire, ScoreWire,
} from "../../../src/wire.ts";
import { ExerciseRail } from "../components/ExerciseRail.tsx";
import { RepLookup } from "../components/RepLookup.tsx";
import { Exercise } from "./Exercise.tsx";
import { Gigs } from "./Gigs.tsx";

const PRICES = { ask: "0.020000", submit: "0.050000", rank: "0.250000" };
const problem = (id: string, level: ProblemWire["level"], par: number | null): ProblemWire =>
  ({ id, title: id[0]!.toUpperCase() + id.slice(1), category: "a skill", level, par, prices: PRICES });
/** The seven, as the gym lists them. */
const SEVEN: ProblemWire[] = [
  problem("blackbox", "hard", null), problem("zendo", "medium", null), problem("toll", "easy", 1),
  problem("bisect", "easy", null), problem("codebreaker", "medium", 4), problem("ranking", "medium", 16),
  problem("liar", "hard", 14),
];
const AGENT = "0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce";
const SCRIBE = "0x893E38EDEcbE400Ee8fB1577C6dE3876Cb4973de";
const score = (attempt: string, spend: string, ranked = false): ScoreWire => ({
  attempt, agent: `agent-${attempt}`, payer: AGENT, identity: null, problem: "liar", seed: "s", fingerprint: "0x",
  solved: true, spend, probes: 14, submissions: 1, wallTimeMs: 1, endedBy: "solved", ranked,
});

/** The server, scripted: each path answers what the real one would. Nothing here reaches one. */
function serving(routes: Record<string, unknown | 404>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const body = routes[String(input)];
    if (body === undefined || body === 404) return new Response(JSON.stringify({ error: "not here" }), { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

function show(node: React.ReactNode) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queries}>{node}</QueryClientProvider>);
}

beforeEach(() => { vi.restoreAllMocks(); });

describe("the rack", () => {
  test("lists every exercise the gym serves, numbered, each with its own link", () => {
    show(<ExerciseRail problems={SEVEN} chosen="liar" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(7);
    expect(links[0]).toHaveTextContent("01");
    expect(links[6]).toHaveAttribute("href", "#rig/liar");
    expect(links[6]).toHaveAttribute("aria-current", "true");
    expect(links[0]).not.toHaveAttribute("aria-current");
  });
});

describe("an exercise", () => {
  const liar: ProblemDetailWire = { ...problem("liar", "hard", 14), statement: "A hidden number.", scoring: "cost" };

  test("shows the gym's statement, its level, and par in probes and in dollars", async () => {
    vi.stubGlobal("fetch", serving({ "/problems/liar": liar, "/leaderboard/liar": [] }));
    show(<Exercise id="liar" number={7} demoHref={null} />);
    expect(await screen.findByText("A hidden number.")).toBeInTheDocument();
    expect(screen.getByText("Exercise 07")).toBeInTheDocument();
    expect(screen.getByText("hard")).toBeInTheDocument();
    expect(screen.getByText("14 probes")).toBeInTheDocument();
    expect(screen.getByText("Par costs").nextSibling).toHaveTextContent("$0.28");
  });

  test("says no par is proven rather than showing a number", async () => {
    vi.stubGlobal("fetch", serving({ "/problems/zendo": { ...problem("zendo", "medium", null), statement: "s", scoring: "c" },
                                     "/leaderboard/zendo": [] }));
    show(<Exercise id="zendo" number={2} demoHref={null} />);
    expect(await screen.findByText("none proven")).toBeInTheDocument();
  });

  test("its board keeps the gym's order, cheapest first, and marks the ranked solves", async () => {
    vi.stubGlobal("fetch", serving({ "/problems/liar": liar,
      "/leaderboard/liar": [score("a1", "0.280000", true), score("a2", "0.400000")] }));
    show(<Exercise id="liar" number={7} demoHref={null} />);
    const rows = await screen.findAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("agent-a1");
    expect(rows[0]).toHaveTextContent("ranked");
    expect(rows[1]).toHaveTextContent("agent-a2");
    expect(rows[1]).not.toHaveTextContent("ranked");
  });

  test("an empty board says what would fill it", async () => {
    vi.stubGlobal("fetch", serving({ "/problems/liar": liar, "/leaderboard/liar": [] }));
    show(<Exercise id="liar" number={7} demoHref={null} />);
    expect(await screen.findByText(/first paid solve takes first place/i)).toBeInTheDocument();
  });
});

describe("looking up rep", () => {
  const rating: ChainRatingWire = { agent: "894767", rating: 3, ranked: ["toll", "codebreaker"], scribe: SCRIBE, source: "erc-8004" };
  const lookup = (looking: string, registry: string | null = "0x8004B663056A597Dffe9eCcC1965A193B7388713") =>
    <RepLookup looking={looking} registry={registry} explorer="https://testnet.arcscan.app" />;

  test("an identity shows the rep the gate reads, out of what the gym's problems allow", async () => {
    vi.stubGlobal("fetch", serving({ "/problems": SEVEN, "/rating/894767": rating }));
    show(lookup("894767"));
    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(await screen.findByText("/ 14 rep")).toBeInTheDocument();
    const ranked = screen.getAllByRole("listitem");
    expect(ranked.map((li) => li.textContent)).toEqual(["Toll+1", "Codebreaker+2"]);
  });

  test("it says whose entries count and where to check them", async () => {
    vi.stubGlobal("fetch", serving({ "/problems": SEVEN, "/rating/894767": rating }));
    show(lookup("894767"));
    const scribe = await screen.findByRole("link", { name: "0x893E…73de" });
    expect(scribe).toHaveAttribute("href", `https://testnet.arcscan.app/address/${SCRIBE}`);
    expect(screen.getByText("readAllFeedback")).toBeInTheDocument();
  });

  test("a server with no registry says there is no rep to read", async () => {
    vi.stubGlobal("fetch", serving({ "/problems": SEVEN, "/rating/894767": 404 }));
    show(lookup("894767", null));
    expect(await screen.findByText(/no reputation registry/i)).toBeInTheDocument();
  });

  test("an address shows the runs it paid for, and points at the identity for rep", async () => {
    const record: AgentRecordWire = { agent: AGENT, spend: "0.230000", attempts: 4, solved: 3, refused: 1, runs: [] };
    vi.stubGlobal("fetch", serving({ "/problems": SEVEN, [`/agents/${AGENT}`]: record }));
    show(lookup(AGENT));
    const spent = await screen.findByText("Spent solving");
    expect(spent.parentElement).toHaveTextContent("$0.23");
    expect(screen.getByText(/look that up by its id/i)).toBeInTheDocument();
  });

  test("something that is neither is said to be neither", () => {
    vi.stubGlobal("fetch", serving({ "/problems": SEVEN }));
    show(lookup("agent:aria"));
    expect(screen.getByText(/neither an ERC-8004 id nor an address/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Look up" })).toBeDisabled();
  });
});

describe("a won gig", () => {
  const gig = (over: Partial<BountyWire>): BountyWire => ({
    id: "b1", poster: "0xposter", title: "Hash the gym's name", statement: "Return it.", amount: "0.100000",
    deadline: Date.now() + 86_400_000, minRating: 3, postedAt: 0, attempts: 1, open: false,
    solvedBy: AGENT, solvedAt: 1, awardTx: "0xb0c6aae8", awaitingPayout: false, escrowId: "3", ...over,
  });

  test("says who won it and links the payout", () => {
    show(<Gigs bounties={[gig({})]} explorer="https://testnet.arcscan.app" />);
    expect(screen.getByText(/0x3535…61ce/i).closest("p")).toHaveTextContent(/Won by 0x3535…61ce · paid on chain/i);
    expect(screen.getByRole("link", { name: "paid on chain" })).toHaveAttribute("href", "https://testnet.arcscan.app/tx/0xb0c6aae8");
  });

  test("a win whose payout has not landed says so", () => {
    show(<Gigs bounties={[gig({ awardTx: null, awaitingPayout: true })]} explorer="https://testnet.arcscan.app" />);
    expect(screen.getByText(/paying out/i)).toBeInTheDocument();
  });
});
