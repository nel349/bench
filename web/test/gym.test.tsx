import { describe, expect, test, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "./strings.tsx";
import { MAINNET, TESTNET, on } from "./network.ts";
import type { Network } from "../src/shared/network/network.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  AgentRecordWire, BountyWire, ChainRatingWire, ProblemDetailWire, ProblemWire, ScoreWire, StandingsWire,
} from "../../src/shared/wire.ts";
import { ExerciseRail } from "../src/train/ExerciseRail.tsx";
import { RepLookup } from "../src/rep/RepLookup.tsx";
import { Exercise } from "../src/train/Exercise.tsx";
import { Gigs } from "../src/gigs/Gigs.tsx";
import { Home } from "../src/shell/Home.tsx";
import { Nav } from "../src/shell/Nav.tsx";

const PRICES = { ask: "0.020000", submit: "0.050000", rank: "0.250000" };
const problem = (id: string, level: ProblemWire["level"], par: number | null): ProblemWire =>
  ({ id, title: id[0]!.toUpperCase() + id.slice(1), category: "a skill", level, summary: `What ${id} is.`, par, prices: PRICES });
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
    const body = await routes[String(input)];
    if (body === undefined || body === 404) return new Response(JSON.stringify({ error: "not here" }), { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

function show(node: React.ReactNode, network: Network = TESTNET) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queries}>{node}</QueryClientProvider>, { network });
}

beforeEach(() => { vi.restoreAllMocks(); });

describe("the rack", () => {
  /** They were numbered by the order the gym listed them in, which meant nothing to a reader. */
  test("lists every exercise the gym serves, each with its own link, after the way back to them all", () => {
    show(<ExerciseRail problems={SEVEN} chosen="liar" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(8);
    expect(links[0]).toHaveTextContent("All exercises");
    expect(links[0]).toHaveAttribute("href", "/#exercises");
    expect(links[1]).toHaveTextContent(/^Blackbox$/);
    expect(links[7]).toHaveAttribute("href", "/#exercises/liar");
    expect(links[7]).toHaveAttribute("aria-current", "true");
    expect(links[1]).not.toHaveAttribute("aria-current");
  });
});

const WALLET_NONE = { owner: null, connectHref: null, connect: () => {}, returned: () => {}, offer: () => {}, forget: () => {}, beginConnect: () => {} };
const TABLE: StandingsWire = {
  agents: [
    { identity: "894767", rep: 14, ranked: ["toll", "liar"], holds: ["toll", "liar"], runs: 15, lastRunAt: Date.now() - 3_600_000 },
    { identity: "896922", rep: 1, ranked: ["toll"], holds: [], runs: 2, lastRunAt: Date.now() - 86_400_000 },
  ],
  best: [
    { problem: "liar", identity: "894767", spend: "0.280000", probes: 14, attempt: "a16" },
    { problem: "toll", identity: "894767", spend: "0.020000", probes: 1, attempt: "a10" },
  ],
  more: 0,
};

/**
 * The pages were set out as the gym's loop, and the first one led with gigs and rep. An owner could
 * not say what they were looking at. These are the same pages in the order an owner needs them.
 */
describe("the first screen and the pages", () => {
  const front = (hash: string, standings: StandingsWire = TABLE, over: Record<string, unknown> = {}, walletUrl: string | null = null) => {
    window.location.hash = hash;
    // jsdom has no matchMedia; a browser asked to reduce motion holds the demo on a finished board.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {},
    }));
    vi.stubGlobal("fetch", serving({
      "/problems": SEVEN, "/bounties": [], "/feed": [], "/standings": standings,
      "/problems/liar": { ...problem("liar", "hard", 14), statement: "s", scoring: "c" }, "/leaderboard/liar": [],
      "/problems/blackbox": { ...problem("blackbox", "hard", null), statement: "s", scoring: "c" }, "/leaderboard/blackbox": [],
      ...over,
    }));
    show(<Home probePrice="0.020000" />, on(TESTNET, { walletUrl, registry: null }));
  };

  test("the first screen says what Bench is for, the way in, and what an owner does", async () => {
    front("", TABLE, {}, "https://wallet.test/");
    expect(document.title).toBe("Bench: a gym for agents");
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("See what your agent can really do.");
    expect(screen.getByRole("link", { name: "Set up your agent" })).toHaveAttribute("href", "/fund");
    expect(screen.getByRole("link", { name: "See the standings" })).toHaveAttribute("href", "/#standings");
    const how = screen.getByRole("region", { name: "How it goes" });
    expect(within(how).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "You give it an allowance", "You tell it to train", "You watch where it stands",
    ]);
    // The demo and the exercise menu are on Exercises, where they explain something.
    expect(screen.queryByRole("region", { name: /demonstration of the black box/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Exercises" })).not.toBeInTheDocument();
  });

  /** "A few cents" beside a record of $0.02 hid that being recorded costs a quarter. */
  test("the first screen says both prices: a question, and recording a solve", async () => {
    front("");
    const how = await screen.findByRole("region", { name: "How it goes" });
    expect(await within(how).findByText(/what it costs/i)).toHaveTextContent("What it costs: $0.02 for each question, and $0.25 to record a solve");
  });

  /** "Enough rep lets it take paid work" was the first time rep was mentioned, with no word of what it is. */
  test("the first screen says what rep is where it first mentions it", async () => {
    front("");
    const how = await screen.findByRole("region", { name: "How it goes" });
    expect(how).toHaveTextContent("Its rep is its score: a point for each easy exercise it has recorded, two for a medium, three for a hard.");
  });

  test("the first screen says what a newcomer needs before they press anything", async () => {
    front("", TABLE, {}, "https://wallet.test/");
    expect(await screen.findByText(/you need a phone, and Claude Code, Cursor or Codex on a laptop/i)).toBeInTheDocument();
  });

  /** Where no wallet serves the network there is no allowance to give, and the first screen must not promise one. */
  test("with no wallet on the network, the first step is a balance and no allowance is promised", async () => {
    front("");
    const how = await screen.findByRole("region", { name: "How it goes" });
    expect(within(how).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "You give it a balance", "You tell it to train", "You watch where it stands",
    ]);
    expect(how).toHaveTextContent("What you add is the most it can spend, and it cannot be taken back.");
    expect(how).not.toHaveTextContent(/allowance|on your phone/);
  });

  test("it says who leads, the cheapest record and how many are on the standings, from the gym's own count", async () => {
    front("");
    expect((await screen.findByText("Leading now")).nextSibling).toHaveTextContent("agent #894767, 14 rep");
    expect(screen.getByText("Cheapest record").nextSibling).toHaveTextContent("Toll, $0.02");
    expect(screen.getByText("On the standings").nextSibling).toHaveTextContent("2 agents, 17 runs");
  });

  test("the agents on the standings are counted whole, the ones the gym did not list included", async () => {
    front("", { ...TABLE, more: 40 });
    expect((await screen.findByText("On the standings")).nextSibling).toHaveTextContent("42 agents, 17 runs");
  });

  /** Paid work is the reason to earn rep. A phone has no frame edge to say some is open, so the first screen does. */
  test("when a gig is open it says so, with what is on offer, and leads there; with none it says nothing of gigs", async () => {
    const open = { id: "b9", poster: "0xp", title: "Open one", statement: "s", amount: "0.500000", escrowId: "9", deadline: Date.now() + 86_400_000,
                   minRating: 3, postedAt: 0, solvedBy: null, solvedAt: null, awardTx: null, attempts: 0, open: true, awaitingPayout: false, solverIdentity: null };
    front("", TABLE, { "/bounties": [open, { ...open, id: "b1", open: false }] });
    const fact = (await screen.findByText("Paid work open")).nextElementSibling!;
    expect(fact).toHaveTextContent("1 gig open · $0.50 on offer");
    expect(within(fact as HTMLElement).getByRole("link")).toHaveAttribute("href", "/#gigs");
  });

  test("with no gig open the first screen says nothing of gigs", async () => {
    front("");
    await screen.findByText("Leading now");
    expect(screen.queryByText("Paid work open")).not.toBeInTheDocument();
  });

  /** A first screen with zeroes on it reads as a place nobody uses. */
  test("with nobody on the standings yet it says none of that", async () => {
    front("", { agents: [], best: [], more: 0 });
    await screen.findByRole("region", { name: "How it goes" });
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith("/standings", expect.anything()));
    expect(screen.queryByText("Leading now")).not.toBeInTheDocument();
    expect(screen.queryByText("On the standings")).not.toBeInTheDocument();
  });

  test("the pages are named for what an owner wants, in that order, with no numbers or arrows between", async () => {
    front("");
    const tabs = await screen.findByRole("navigation", { name: "Pages" });
    expect(within(tabs).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Start", "/fund"], ["My agent", "/#yours"], ["Exercises", "/#exercises"], ["Standings", "/#standings"], ["Gigs", "/#gigs"],
    ]);
    expect(tabs).not.toHaveTextContent(/→|0\d/);
  });

  test("with a wallet connected, My agent opens that wallet's own page", () => {
    const WALLET = "0x9fa928ACfE2eEcEad9698ebBad835E7129688b28";
    show(<Nav current="home" wallet={{ ...WALLET_NONE, owner: WALLET, connectHref: "https://wallet.test/connect" }} />);
    const tab = screen.getByRole("link", { name: "My agent" });
    expect(tab).toHaveAttribute("href", `/#yours/${WALLET}`);
    expect(tab).not.toHaveAttribute("aria-current");
  });

  test("the page showing is marked, Start among them", () => {
    const { rerender } = render(<Nav current="yours" wallet={WALLET_NONE} />);
    expect(screen.getByRole("link", { name: "My agent" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Start" })).not.toHaveAttribute("aria-current");
    rerender(<Nav current="start" wallet={WALLET_NONE} />);
    expect(screen.getByRole("link", { name: "Start" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "My agent" })).not.toHaveAttribute("aria-current");
  });

  /** The brand reloaded the whole app: its link had no hash, where every other link switches the view. */
  test("the brand leads to the front page without leaving the app", async () => {
    front("#gigs");
    expect(await screen.findByRole("link", { name: "BENCH//" })).toHaveAttribute("href", "/#home");
  });

  test("Exercises lists every exercise, easiest first, each a link to its own page", async () => {
    front("#exercises");
    const rows = await screen.findAllByRole("heading", { level: 3 });
    expect(rows.map((h) => h.textContent)).toEqual(["Toll", "Bisect", "Zendo", "Codebreaker", "Ranking", "Blackbox", "Liar"]);
    expect(within(rows[6]!).getByRole("link", { name: "Liar" })).toHaveAttribute("href", "/#exercises/liar");
    expect(screen.getByRole("link", { name: "Watch a demo run" })).toHaveAttribute("href", "/#exercises/blackbox/demo");
    // The list, not one exercise: no rail, and no demo playing.
    expect(screen.queryByRole("navigation", { name: "Exercises" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /demonstration of the black box/i })).not.toBeInTheDocument();
  });

  test("one exercise has its own page, with the others along the rail", async () => {
    front("#exercises/liar");
    expect(await screen.findByRole("navigation", { name: "Exercises" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 2, name: "Liar" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Set up your agent" })).not.toBeInTheDocument();
  });

  /** Agents gave out `#rig/…` links, and people kept them. */
  test("a link under the page's former name still opens the exercise, and the address bar is put right", async () => {
    front("#rig/liar");
    expect(await screen.findByRole("heading", { level: 2, name: "Liar" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#exercises/liar");
  });

  /** "0 puzzles with a hidden answer" over an empty box is a claim about the gym, made before it had answered. */
  test("until the gym has said what its exercises are, the page says it is reading, and claims nothing", async () => {
    front("#exercises", TABLE, { "/problems": new Promise(() => {}) });
    expect(await screen.findByText("Reading the exercises…")).toBeInTheDocument();
    expect(screen.queryByText(/puzzles? with a hidden answer/)).not.toBeInTheDocument();
  });

  test("exercises that cannot be read are said to be unread, not none", async () => {
    front("#exercises", TABLE, { "/problems": 404 });
    expect(await screen.findByText(/the exercises could not be read just now/i)).toBeInTheDocument();
    expect(screen.queryByText(/puzzles? with a hidden answer/)).not.toBeInTheDocument();
  });

  test("an exercise the gym does not serve opens the list, not an empty page", async () => {
    front("#exercises/chess");
    expect(await screen.findAllByRole("heading", { level: 3 })).toHaveLength(7);
  });

  test("the demo is asked for by name, and Black Box's own page links to it", async () => {
    front("#exercises/blackbox");
    expect(await screen.findByRole("link", { name: "Watch the demo" })).toHaveAttribute("href", "/#exercises/blackbox/demo");
    expect(screen.queryByRole("region", { name: /demonstration of the black box/i })).not.toBeInTheDocument();
  });

  test("the demo plays under the rail, and leads back to the exercise's page", async () => {
    front("#exercises/blackbox/demo");
    const demo = await screen.findByRole("region", { name: /demonstration of the black box/i });
    expect(within(demo).getByRole("link", { name: "See its leaderboard" })).toHaveAttribute("href", "/#exercises/blackbox");
    expect(screen.getByRole("navigation", { name: "Exercises" })).toBeInTheDocument();
  });

  test("only Black Box has a demo: the word after another exercise is ignored", async () => {
    front("#exercises/liar/demo");
    expect(await screen.findByRole("heading", { level: 2, name: "Liar" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /demonstration of the black box/i })).not.toBeInTheDocument();
  });

  test("Standings shows who is ahead, and under it the rep lookup and the runs", async () => {
    front("#standings");
    expect(await screen.findByRole("heading", { level: 2 })).toHaveTextContent("Who is ahead.");
    expect(await screen.findByRole("link", { name: "Agent #894767" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Look up an agent's rep" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Every run, on the record." })).toBeInTheDocument();
  });

  test("a link to the old record page opens Standings with that agent looked up", async () => {
    front("#ledger/894767");
    expect(await screen.findByRole("heading", { level: 2 })).toHaveTextContent("Who is ahead.");
    expect(screen.getByLabelText(/look up rep/i)).toHaveValue("894767");
  });
});

/** The rules live in a hook with its own tests; these check the page hands the right one to the right place. */
describe("coming back from the wallet, and opening an owner's link", () => {
  const WALLET = "0x9fa928ACfE2eEcEad9698ebBad835E7129688b28";
  let kept: Map<string, string>;
  const OTHER = "0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce";
  /** What the browser already holds when the page opens: a connected wallet, an asking, or nothing. */
  const arrive = (hash: string, holding: Record<string, string> = {}) => {
    // This test environment has no working localStorage; a browser's is a map of strings like this one.
    kept = new Map(Object.entries(holding));
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    });
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {},
    }));
    vi.stubGlobal("fetch", serving({ "/problems": SEVEN, "/bounties": [], "/feed": [],
      [`/owner/${WALLET}`]: { wallet: WALLET, agents: [], more: 0, partial: false },
      [`/owner/${OTHER}`]: { wallet: OTHER, agents: [], more: 0, partial: false } }));
    window.location.hash = hash;
    show(<Home probePrice="0.020000" />, on(TESTNET, { registry: null }));
  };

  test("back with an address: it is connected, and its page opens", async () => {
    arrive(`#connected/${WALLET}`);
    await waitFor(() => expect(window.location.hash).toBe(`#yours/${WALLET}`));
    expect(kept.get("bench.owner.wallet")).toBe(WALLET);
    expect(await screen.findByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  test("back with nothing, having cancelled: the front page, nothing connected, and the asking over", async () => {
    arrive("#connected/", { "bench.owner.connecting": String(Date.now()) });
    await waitFor(() => expect(window.location.hash).toBe("#home"));
    expect(kept.has("bench.owner.wallet")).toBe(false);
    // The hook is told of the empty answer too. Left standing, the asking let the next link of this shape in.
    expect(kept.has("bench.owner.connecting")).toBe(false);
  });

  /** The answer's shape is a link anyone can make. Unasked, it must not change whose agents these are. */
  test("a link shaped like the wallet's answer, opened unasked, does not replace the connected wallet", async () => {
    arrive(`#connected/${OTHER}`, { "bench.owner.wallet": WALLET });
    await waitFor(() => expect(window.location.hash).toBe(`#yours/${OTHER}`));
    expect(kept.get("bench.owner.wallet")).toBe(WALLET);
  });

  test("the answer to a Connect wallet pressed here does replace it", async () => {
    arrive(`#connected/${OTHER}`, { "bench.owner.wallet": WALLET, "bench.owner.connecting": String(Date.now()) });
    await waitFor(() => expect(kept.get("bench.owner.wallet")).toBe(OTHER));
  });

  test("another wallet's page, opened while one is connected, leaves it connected", async () => {
    arrive(`#yours/${OTHER}`, { "bench.owner.wallet": WALLET });
    expect(await screen.findByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    // Its page has been read and shown, which is when a page offers its wallet.
    await screen.findByText(/has not granted an allowance to any agent/);
    expect(kept.get("bench.owner.wallet")).toBe(WALLET);
  });

  /** A look-up is not a connection: the reader who pasted an address found it in the header as theirs. */
  test("an address typed on My agent opens its page and leaves the connected wallet as it was", async () => {
    const user = userEvent.setup();
    arrive("#yours", { "bench.owner.wallet": WALLET });
    await user.type(await screen.findByLabelText(/wallet/i), OTHER);
    await user.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(window.location.hash).toBe(`#yours/${OTHER}`));
    expect(kept.get("bench.owner.wallet")).toBe(WALLET);
  });



  test("Disconnect disconnects: nothing is kept, and Connect wallet is offered again", async () => {
    const user = userEvent.setup();
    arrive("", { "bench.owner.wallet": WALLET });
    await user.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(kept.has("bench.owner.wallet")).toBe(false);
    expect(await screen.findByRole("link", { name: "Connect Mandate" })).toBeInTheDocument();
  });

  /** How their agent is doing is what an owner comes back for, and it was a tab away from where they landed. */
  test("an owner whose wallet is connected, opening the gym, lands on their own agent", async () => {
    arrive("", { "bench.owner.wallet": WALLET });
    await waitFor(() => expect(window.location.hash).toBe(`#yours/${WALLET}`));
    expect(screen.queryByRole("region", { name: "How it goes" })).not.toBeInTheDocument();
  });

  test("the first screen is still theirs to read when it is asked for by name, as the brand's link does", async () => {
    arrive("#home", { "bench.owner.wallet": WALLET });
    expect(await screen.findByRole("region", { name: "How it goes" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#home");
  });

  /**
   * It used to connect that wallet once its page showed, and the same held for any wallet's link or
   * a pasted address: a reader who looked a wallet up found it in the header as theirs. Now the owner
   * says so, with one press.
   */
  test("an owner's link, opened with no wallet connected, connects nothing until its owner says it is theirs", async () => {
    const user = userEvent.setup();
    arrive(`#yours/${WALLET}`);
    await screen.findByText(/has not granted an allowance to any agent/);
    expect(kept.has("bench.owner.wallet")).toBe(false);
    await user.click(screen.getByRole("button", { name: "This is my wallet" }));
    expect(kept.get("bench.owner.wallet")).toBe(WALLET);
    expect(await screen.findByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  test("pressing Connect wallet notes that it was pressed", async () => {
    const user = userEvent.setup();
    arrive("");
    const connect = await screen.findByRole("link", { name: "Connect Mandate" });
    // Kept in the app for the click: the wallet is another site.
    connect.addEventListener("click", (event) => event.preventDefault());
    await user.click(connect);
    expect(Number(kept.get("bench.owner.connecting"))).toBeGreaterThan(0);
  });
});

describe("an exercise", () => {
  const liar: ProblemDetailWire = { ...problem("liar", "hard", 14), statement: "A hidden number.", scoring: "cost" };

  test("shows the gym's statement, its level, and the fewest questions it needs, in questions and in dollars", async () => {
    vi.stubGlobal("fetch", serving({ "/problems/liar": liar, "/leaderboard/liar": [] }));
    show(<Exercise id="liar" demoHref={null} />);
    expect(await screen.findByText("A hidden number.")).toBeInTheDocument();
    expect(screen.getByText("hard")).toBeInTheDocument();
    expect(screen.getByText("14 questions")).toBeInTheDocument();
    expect(screen.getByText("That costs").nextSibling).toHaveTextContent("$0.28");
  });

  test("says no fewest is proven rather than showing a number", async () => {
    vi.stubGlobal("fetch", serving({ "/problems/zendo": { ...problem("zendo", "medium", null), statement: "s", scoring: "c" },
                                     "/leaderboard/zendo": [] }));
    show(<Exercise id="zendo" demoHref={null} />);
    expect(await screen.findAllByText("not known yet")).toHaveLength(2);
  });

  test("says how an agent gets to play: through the skill where there is an allowance to give", async () => {
    vi.stubGlobal("fetch", serving({ "/problems/liar": liar, "/leaderboard/liar": [] }));
    show(<Exercise id="liar" demoHref={null} />);
    expect(await screen.findByText(/through the Bench skill/)).toBeInTheDocument();
  });

  /** The skill pays through the owner's wallet. Where none serves the network, sending an agent to it sends it nowhere. */
  test("with no wallet on the network, it sends the reader to Start for how, and does not name the skill", async () => {
    vi.stubGlobal("fetch", serving({ "/problems/liar": liar, "/leaderboard/liar": [] }));
    show(<Exercise id="liar" demoHref={null} />, MAINNET);
    const how = (await screen.findByText(/how it gets to, on this network, is on/i)).closest("p")!;
    expect(within(how).getByRole("link", { name: "Start" })).toHaveAttribute("href", "/fund");
    expect(how).not.toHaveTextContent(/skill/i);
  });

  test("its leaderboard keeps the gym's order, cheapest first, and marks the recorded solves", async () => {
    vi.stubGlobal("fetch", serving({ "/problems/liar": liar,
      "/leaderboard/liar": [score("a1", "0.280000", true), score("a2", "0.400000")] }));
    show(<Exercise id="liar" demoHref={null} />);
    const rows = await screen.findAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("agent-a1");
    expect(rows[0]).toHaveTextContent("recorded");
    expect(rows[1]).toHaveTextContent("agent-a2");
    expect(rows[1]).not.toHaveTextContent("recorded");
  });

  test("an empty leaderboard says what would fill it", async () => {
    vi.stubGlobal("fetch", serving({ "/problems/liar": liar, "/leaderboard/liar": [] }));
    show(<Exercise id="liar" demoHref={null} />);
    expect(await screen.findByText(/first paid solve takes first place/i)).toBeInTheDocument();
  });
});

describe("looking up rep", () => {
  const rating: ChainRatingWire = { agent: "894767", rating: 3, ranked: ["toll", "codebreaker"], scribe: SCRIBE, source: "erc-8004" };
  const lookup = (looking: string) => <RepLookup looking={looking} showResult />;

  test("an identity shows the rep the gate reads, out of what the gym's exercises allow", async () => {
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
    show(lookup("894767"), on(TESTNET, { registry: null }));
    expect(await screen.findByText(/no reputation registry/i)).toBeInTheDocument();
  });

  test("an address shows the runs it paid for, and points at the identity for rep", async () => {
    const record: AgentRecordWire = { agent: AGENT, spend: "0.230000", attempts: 4, solved: 3, refused: 1, runs: [] };
    vi.stubGlobal("fetch", serving({ "/problems": SEVEN, [`/agents/${AGENT}`]: record }));
    show(lookup(AGENT));
    const spent = await screen.findByText("Spent solving");
    expect(spent.parentElement).toHaveTextContent("$0.23");
    expect(screen.getByText(/look that up by its number/i)).toBeInTheDocument();
  });

  /**
   * The answer is under the standings. Pressing an agent's name in the table changed something a
   * screen below, and looked as though it had done nothing.
   */
  test("somebody looked up is brought into view; opening the page with nobody looked up moves nothing", () => {
    const scrolled = vi.fn();
    vi.stubGlobal("fetch", serving({ "/problems": SEVEN, "/rating/894767": rating }));
    Element.prototype.scrollIntoView = scrolled;
    const { rerender } = show(lookup(""));
    expect(scrolled).not.toHaveBeenCalled();
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(<QueryClientProvider client={queries}>{lookup("894767")}</QueryClientProvider>);
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled.mock.instances[0]).toBe(screen.getByRole("region", { name: "Look up an agent's rep" }));
  });

  test("something that is neither is said to be neither", () => {
    vi.stubGlobal("fetch", serving({ "/problems": SEVEN }));
    show(lookup("agent:aria"));
    expect(screen.getByText(/neither an agent's number nor an address/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Look up" })).toBeDisabled();
  });
});

describe("a won gig", () => {
  /** A newcomer saw ten-cent gigs needing rep that costs a quarter a record, and nothing said who posts them or that rep is kept. */
  test("the page says who posts gigs and how, and that rep is earned once", () => {
    vi.stubGlobal("fetch", serving({}));
    show(<Gigs bounties={[]} mine={undefined} />);
    expect(screen.getByText(/whoever needs something solved posts it through Bench's API/i)).toBeInTheDocument();
    expect(screen.getByText(/rep is earned once, by recording solves, and counts for every gig after/i)).toBeInTheDocument();
  });

  const gig = (over: Partial<BountyWire>): BountyWire => ({
    id: "b1", poster: "0xposter", title: "Hash the gym's name", statement: "Return it.", amount: "0.100000",
    deadline: Date.now() + 86_400_000, minRating: 3, postedAt: 0, attempts: 1, open: false, solverIdentity: null,
    solvedBy: AGENT, solvedAt: 1, awardTx: "0xb0c6aae8", awaitingPayout: false, escrowId: "3", ...over,
  });

  test("says who won it and links the payout", () => {
    show(<Gigs bounties={[gig({})]} mine={undefined} />);
    expect(screen.getByText(/0x3535…61ce/i).closest("p")).toHaveTextContent(/Won by 0x3535…61ce · paid on chain/i);
    expect(screen.getByRole("link", { name: "paid on chain" })).toHaveAttribute("href", "https://testnet.arcscan.app/tx/0xb0c6aae8");
  });

  /** Every other screen names the agent; a win named only an address. */
  test("a winner with an identity is named by its agent", () => {
    show(<Gigs bounties={[gig({ solverIdentity: "894767" })]} mine={undefined} />);
    expect(screen.getByText(/agent #894767/i).closest("p")).toHaveTextContent(/Won by agent #894767/i);
  });

  test("with every gig closed, the page says what to do rather than showing only faded cards", () => {
    show(<Gigs bounties={[gig({})]} mine={undefined} />);
    expect(screen.getByText(/no gig is open right now/i)).toBeInTheDocument();
  });

  test("an open gig says which of the connected wallet's agents may enter", () => {
    const open = gig({ id: "b9", open: true, solvedBy: null, solvedAt: null, awardTx: null });
    const mine = { wallet: "0xw", more: 0, partial: false, agents: [{ address: AGENT, current: true, identity: "894767", rep: 14, repUnread: false,
      ranked: [], live: null, runs: [], spend: "0", qualifies: ["b9"], won: [], allowance: null }] };
    show(<Gigs bounties={[open]} mine={mine} />);
    expect(screen.getByText(/your agent #894767 can enter/i)).toBeInTheDocument();
    expect(screen.queryByText(/no gig is open right now/i)).not.toBeInTheDocument();
  });

  /** It was one grid, and with nothing open it was a page of faded cards under a promise of paid work. */
  test("what is open and what has finished are kept apart, and the sums say which is which", () => {
    const open = gig({ id: "b9", title: "Open one", amount: "0.500000", open: true, solvedBy: null, solvedAt: null, awardTx: null });
    const paid = gig({ id: "b1" });
    const paying = gig({ id: "b2", title: "Still paying", awardTx: null, awaitingPayout: true });
    const lapsed = gig({ id: "b3", title: "Ran out", solvedBy: null, solvedAt: null, awardTx: null });
    show(<Gigs bounties={[lapsed, paying, paid, open]} mine={undefined} />);
    expect(screen.getByText("On offer now").nextSibling).toHaveTextContent("$0.50");
    // Paid out is what has landed: the win still on its way, and the gig nobody won, are not in it.
    expect(screen.getByText("Paid out so far").nextSibling).toHaveTextContent("$0.10");
    expect(screen.getByText("Gigs posted").nextSibling).toHaveTextContent("4");
    const titles = (name: string) => within(screen.getByRole("region", { name })).getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(titles("Open now")).toEqual(["Open one"]);
    // The ones somebody won before the one that ran out, though the gym listed that one first.
    expect(titles("Finished")).toEqual(["Still paying", "Hash the gym's name", "Ran out"]);
  });

  test("with nothing open, Open now says so in its place, above what has finished", () => {
    show(<Gigs bounties={[gig({})]} mine={undefined} />);
    expect(within(screen.getByRole("region", { name: "Open now" })).getByText(/no gig is open right now/i)).toBeInTheDocument();
    expect(screen.getByText("On offer now").nextSibling).toHaveTextContent("$0.00");
  });

  test("a win whose payout has not landed says so", () => {
    show(<Gigs bounties={[gig({ awardTx: null, awaitingPayout: true })]} mine={undefined} />);
    expect(screen.getByText(/paying out/i)).toBeInTheDocument();
  });
});
