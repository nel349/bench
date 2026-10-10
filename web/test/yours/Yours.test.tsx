import { describe, expect, test, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { render, say } from "../strings.tsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BountyWire, OwnerAgentWire, OwnerRunWire, OwnerWire, ProblemWire } from "../../../src/shared/wire.ts";
import { Yours } from "../../src/yours/Yours.tsx";
import { WalletButton } from "../../src/shell/WalletButton.tsx";
import { connectUrl } from "../../src/shared/lib/ownerWallet.ts";
import userEvent from "@testing-library/user-event";
import { runnerName } from "../../src/shared/lib/runner.ts";
import { outcomeOf } from "../../src/shared/lib/outcome.ts";
import { LIVE_FOR_MS } from "../../../src/shared/live.ts";

const WALLET = "0x9fa928ACfE2eEcEad9698ebBad835E7129688b28";
const CONNECT = "https://kuiralabs.github.io/mandate/connect?return=x";
const AGENT = "0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce";
const PRICES = { ask: "0.020000", submit: "0.050000", rank: "0.250000" };
const PROBLEMS: ProblemWire[] = [
  { id: "liar", title: "Liar", category: "search", level: "hard", par: 14, prices: PRICES },
  { id: "toll", title: "Toll", category: "maze", level: "easy", par: 1, prices: PRICES },
];
const run = (attempt: string, over: Partial<OwnerRunWire> = {}): OwnerRunWire => ({
  attempt, agent: "anonymous", payer: AGENT, identity: "894767", problem: "liar", seed: null, fingerprint: "0x",
  solved: false, spend: "0.140000", paid: "0.140000", probes: 7, submissions: 0, wallTimeMs: 1, endedBy: "open",
  ranked: false, startedAt: Date.now() - 60_000, ...over,
});
const agent = (over: Partial<OwnerAgentWire> = {}): OwnerAgentWire => ({
  address: AGENT,
  allowance: { limit: "5.000000", used: "1.255000", remaining: "3.745000", validUntil: 1_791_500_983, live: true },
  identity: "894767", rep: 4, repUnread: false, ranked: ["liar", "toll"], live: null, runs: [], spend: "1.730000", qualifies: [],
  current: true, won: [],
  ...over,
});
const gig: BountyWire = {
  id: "b3", poster: "0xposter", title: "The largest twenty-bit number", statement: "s", amount: "0.100000",
  escrowId: "5", deadline: Date.now() + 3_600_000, minRating: 8, postedAt: 0, solvedBy: null, solvedAt: null,
  awardTx: null, attempts: 0, open: true, awaitingPayout: false, solverIdentity: null,
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
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent()], more: 0, partial: false }));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" />);
    expect(await screen.findByRole("heading", { name: "Agent #894767" })).toBeInTheDocument();
    expect(screen.getByText("4 / 4")).toBeInTheDocument();
    // Left of the limit, and the day it ends, as the test's name has always said.
    expect(screen.getByText("Left to spend").nextSibling).toHaveTextContent("$3.74 of $5.00");
    expect(screen.getByText("Allowance ends").nextSibling).toHaveTextContent(/2026/);
    expect(screen.getByText("Spent training").nextSibling).toHaveTextContent("$1.73");
    expect(screen.getByText(/recorded: liar and toll/i)).toBeInTheDocument();
    expect(screen.getByText(/not playing right now/i)).toBeInTheDocument();
  });

  /** The gap this page exists for: after step 4 nothing showed what the agent was doing. */
  test("a run being played shows live, with its questions and what it has cost so far", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ live: run("a20"), runs: [run("a20")] })], more: 0, partial: false }));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" />);
    expect(await screen.findByText(/playing liar now: 7 questions/i)).toBeInTheDocument();
  });

  test("names the gigs an agent already qualifies for, and how to enter", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ qualifies: ["b3"] })], more: 0, partial: false }));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" />);
    expect(await screen.findByRole("link", { name: gig.title })).toHaveAttribute("href", "/#gigs");
    expect(screen.getByText(/tell your agent which gig to take/i)).toBeInTheDocument();
  });

  /** It was offered again on every refresh of the page's data, which reconnected a wallet just disconnected. */
  test("the wallet is offered once when its page has opened, not again on each refresh", async () => {
    // The owner's page read anew each time, with a total that shows which reading is on screen.
    let reads = 0;
    const steady = serving({ wallet: WALLET, agents: [], more: 0, partial: false });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) !== `/owner/${WALLET}`) return steady(input);
      reads += 1;
      return new Response(JSON.stringify({ wallet: WALLET, agents: [agent({ spend: `${reads}.000000` })], more: 0, partial: false }), { status: 200 });
    }));
    const offer = vi.fn();
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queries}><Yours wallet={WALLET} offer={offer} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" /></QueryClientProvider>);
    await waitFor(() => expect(offer).toHaveBeenCalledWith(WALLET));
    await queries.invalidateQueries();
    await waitFor(() => expect(screen.getByText("Spent training").nextSibling).toHaveTextContent("$2.00"));
    expect(offer).toHaveBeenCalledTimes(1);
  });

  /** After a disconnect, pasting the same address again did nothing: the page remembered having offered it. */
  test("the same wallet, left and opened again, is offered again; and an address typed in is asked for", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [], more: 0, partial: false }));
    const offer = vi.fn(), connect = vi.fn();
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const page = (wallet: string) => (
      <QueryClientProvider client={queries}>
        <Yours wallet={wallet} offer={offer} connect={connect} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" />
      </QueryClientProvider>
    );
    const { rerender } = render(page(WALLET));
    await waitFor(() => expect(offer).toHaveBeenCalledTimes(1));
    rerender(page(""));
    await user.type(screen.getByLabelText(/or paste your wallet's address/i), WALLET);
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(connect).toHaveBeenCalledWith(WALLET);
    rerender(page(WALLET));
    await waitFor(() => expect(offer).toHaveBeenCalledTimes(2));
  });

  test("Connect wallet says it was pressed, on the way out to the wallet", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [], more: 0, partial: false }));
    const onConnect = vi.fn();
    show(<Yours wallet="" offer={() => {}} connect={() => {}} onConnect={onConnect} connectHref="#stay" explorer="https://arcscan.app" />);
    await user.click(screen.getByRole("link", { name: "Connect wallet" }));
    expect(onConnect).toHaveBeenCalled();
  });

  test("a page the chain would not wholly give says it may not be everything", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent()], more: 0, partial: true }));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" />);
    expect(await screen.findByText(/could not be read from the chain just now/i)).toBeInTheDocument();
  });

  /** The line counted only agents the wallet grants to, while every card still tagged its runs "new". */
  test("what an agent the wallet no longer grants to did is neither counted as news nor tagged new", async () => {
    const kept = new Map([[`bench.owner.seen.${WALLET.toLowerCase()}`, String(Date.now() - 3_600_000)]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    });
    const mine = agent({ runs: [run("a40", { paid: "0.300000" })] });
    const gone = agent({ address: "0x00000000000000000000000000000000000000aa", current: false, allowance: null,
                         runs: [run("a41", { paid: "1.200000" })] });
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [mine, gone], more: 0, partial: false }));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" />);
    expect(await screen.findByText(/since you last looked/i)).toHaveTextContent("1 run, $0.30 spent");
    expect(screen.getAllByText("new")).toHaveLength(1);
  });

  test("rep the registry would not give is said to be unread, not none", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ rep: null, repUnread: true, ranked: [] })], more: 0, partial: false }));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" />);
    expect((await screen.findByText("Rep")).nextSibling).toHaveTextContent("unread");
    expect(screen.queryByText("none yet")).not.toBeInTheDocument();
  });

  /** "Revoked" was said of any agent the wallet does not grant to, one it never granted to included. */
  test("an agent the wallet does not grant to is shown without claiming it was revoked", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ current: false, allowance: null })], more: 0, partial: false }));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" />);
    expect((await screen.findByText("Allowance")).nextSibling).toHaveTextContent("none now");
    expect(screen.getByText(/does not grant it an allowance now/i)).toBeInTheDocument();
    expect(screen.queryByText(/revoked/i)).not.toBeInTheDocument();
  });

  test("a wallet with more agents than one page carries says how many are not shown", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent()], more: 5, partial: false }));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" />);
    expect(await screen.findByText("5 more agents of this wallet are not shown.")).toBeInTheDocument();
  });

  test("a wallet with no agents says so and points to Set up", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [], more: 0, partial: false }));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" />);
    expect(await screen.findByText(/has not granted an allowance/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /set up your agent/i })).toBeInTheDocument();
  });

  test("without a wallet it offers to connect one, and still takes a pasted address", () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [], more: 0, partial: false }));
    show(<Yours wallet="" offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" />);
    expect(screen.getByRole("link", { name: "Connect wallet" })).toHaveAttribute("href", CONNECT);
    expect(screen.getByLabelText(/or paste your wallet's address/i)).toBeInTheDocument();
  });

  test("without a wallet it says where the link comes from, and asks for the address", () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [], more: 0, partial: false }));
    show(<Yours wallet="" offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={null} explorer="https://arcscan.app" />);
    expect(screen.getByText(/gives you this page's link when it starts training/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
  });

  /** The line said $0.14 for a run its owner had paid $0.39 for: the record's fee was left out. */
  test("since you last looked counts what was paid, the record's fee included", async () => {
    // This test environment has no working localStorage; a browser's is a map of strings like this one.
    const kept = new Map([[`bench.owner.seen.${WALLET.toLowerCase()}`, String(Date.now() - 3_600_000)]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    });
    const recorded = run("a30", { endedBy: "solved", solved: true, ranked: true, paid: "0.390000" });
    const before = run("a2", { startedAt: Date.now() - 7_200_000, paid: "9.000000" });
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ runs: [recorded, before] })], more: 0, partial: false }));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" />);
    const line = await screen.findByText(/since you last looked/i);
    expect(line).toHaveTextContent("Since you last looked: 1 run, $0.39 spent, 1 recorded.");
    // And its row says the same $0.39, not the $0.14 the run scored.
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("$0.39");
  });

  /** On a phone the list stops at three. The button said "See all 8 runs" and counted the wrong thing. */
  test("runs past the third are held back until asked for, and the button says how many", async () => {
    const user = userEvent.setup();
    const five = ["a5", "a4", "a3", "a2", "a1"].map((id, i) => run(id, { startedAt: Date.now() - (i + 1) * 60_000 }));
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ runs: five })], more: 0, partial: false }));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" />);
    const more = await screen.findByRole("button", { name: "Show 2 more runs" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    // What it says it controls is the table it controls.
    expect(document.getElementById(more.getAttribute("aria-controls")!)).toBe(screen.getByRole("table"));
    const rows = () => screen.getAllByRole("row").slice(1);
    expect(rows().map((r) => r.className)).toEqual(["", "", "", "extra", "extra"]);
    await user.click(more);
    expect(rows().map((r) => r.className)).toEqual(["", "", "", "", ""]);
    // The same button, now the way back, so focus is not lost with it.
    expect(screen.getByRole("button", { name: "Show fewer runs" })).toHaveAttribute("aria-expanded", "true");
  });

  test("three runs or fewer need no button", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ runs: [run("a1"), run("a2"), run("a3")] })], more: 0, partial: false }));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" />);
    await screen.findByRole("heading", { name: "Agent #894767" });
    expect(screen.queryByRole("button", { name: /more run/i })).not.toBeInTheDocument();
  });

  test("a read that fails is said, not shown as an empty wallet", async () => {
    vi.stubGlobal("fetch", serving(500));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" />);
    expect(await screen.findByText(/could not be read just now/i)).toBeInTheDocument();
    expect(screen.queryByText(/has not granted/i)).not.toBeInTheDocument();
  });
});

describe("who ran it, and how it ended", () => {
  /** Every connector run read "anonymous", though each carried a proven identity. */
  test("an unnamed run is called by its identity; a name the agent chose is kept", () => {
    expect(say(runnerName({ agent: "anonymous", identity: "894767" }))).toBe("agent #894767");
    expect(say(runnerName({ agent: "anonymous", identity: null }))).toBe("unnamed agent");
    expect(say(runnerName({ agent: "aria", identity: "894767" }))).toBe("aria");
  });

  test("an open run past the hour reads as left open, not playing", () => {
    const now = 10 * LIVE_FOR_MS;
    expect(say(outcomeOf({ endedBy: "open", ranked: false, startedAt: now - 60_000 }, now).label)).toBe("Playing");
    expect(say(outcomeOf({ endedBy: "open", ranked: false, startedAt: now - 2 * LIVE_FOR_MS }, now).label)).toBe("Left open");
  });
});

describe("connecting a wallet", () => {
  /** The wallet sends the owner back to #connected/<address>, which this page reads. */
  test("Connect wallet asks the wallet to return here, to the view that keeps the address", () => {
    expect(connectUrl("https://kuiralabs.github.io/mandate/", "http://bench.test:8975")).toBe(
      "https://kuiralabs.github.io/mandate/connect?return=" + encodeURIComponent("http://bench.test:8975/#connected/"));
    expect(connectUrl(null, "http://bench.test")).toBeNull();
  });

  test("the header offers Connect wallet, or the connected wallet and Disconnect", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<WalletButton owner={null} connectHref={CONNECT} onConnect={() => {}} onDisconnect={() => {}} />);
    expect(screen.getByRole("link", { name: "Connect wallet" })).toHaveAttribute("href", CONNECT);

    const disconnect = vi.fn();
    rerender(<WalletButton owner={WALLET} connectHref={CONNECT} onConnect={() => {}} onDisconnect={disconnect} />);
    expect(screen.getByText("0x9fa9…8b28")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(disconnect).toHaveBeenCalled();
  });

  test("where no wallet serves the network, the header offers nothing to connect", () => {
    const { container } = render(<WalletButton owner={null} connectHref={null} onConnect={() => {}} onDisconnect={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
