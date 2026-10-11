import { describe, expect, test, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { render, say } from "../strings.tsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BountyWire, OwnerAgentWire, OwnerRunWire, OwnerWire, ProblemWire, StandingsWire } from "../../../src/shared/wire.ts";
import { Yours } from "../../src/yours/Yours.tsx";
import { WalletButton } from "../../src/shell/WalletButton.tsx";
import { connectUrl } from "../../src/shared/lib/ownerWallet.ts";
import userEvent from "@testing-library/user-event";
import { runnerName } from "../../src/shared/lib/runner.ts";
import { outcomeOf } from "../../src/shared/lib/outcome.ts";
import { LIVE_FOR_MS } from "../../../src/shared/live.ts";

const WALLET = "0x9fa928ACfE2eEcEad9698ebBad835E7129688b28";
const MANDATE = "https://kuiralabs.github.io/mandate/";
const GYM = "http://bench.test:8975";
const CONNECT = `${MANDATE}connect?return=x`;
const AGENT = "0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce";
const PRICES = { ask: "0.020000", submit: "0.050000", rank: "0.250000" };
const PROBLEMS: ProblemWire[] = [
  { id: "liar", title: "Liar", category: "search", level: "hard", summary: "Find a number.", par: 14, prices: PRICES },
  { id: "toll", title: "Toll", category: "maze", level: "easy", summary: "Cross a maze.", par: 1, prices: PRICES },
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

function serving(owner: OwnerWire | 500, standings?: StandingsWire) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === `/owner/${WALLET}`) {
      return owner === 500 ? new Response("{}", { status: 500 }) : new Response(JSON.stringify(owner), { status: 200 });
    }
    if (url === "/problems") return new Response(JSON.stringify(PROBLEMS), { status: 200 });
    if (url === "/bounties") return new Response(JSON.stringify([gig]), { status: 200 });
    if (url === "/standings" && standings) return new Response(JSON.stringify(standings), { status: 200 });
    return new Response("{}", { status: 404 });
  });
}

/** The page for one wallet, as the shell draws it. */
const page = <Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" gym={GYM} walletUrl={MANDATE} />;
/** The table of an agent's latest runs, which is one of two tables on its card. */
const runsTable = () => document.getElementById(`runs-${AGENT}`)!;
/** A figure on the card, by its label: the `dd` beside the `dt`. */
const tile = (label: string) => screen.getByText(label).nextElementSibling!;

function show(node: React.ReactNode) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queries}>{node}</QueryClientProvider>);
}

beforeEach(() => { vi.restoreAllMocks(); });

describe("the owner's page", () => {
  test("shows each agent: its identity, rep, what is left to spend, and when the allowance ends", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent()], more: 0, partial: false }));
    show(page);
    expect(await screen.findByRole("heading", { name: "Agent #894767" })).toBeInTheDocument();
    expect(tile("Where it stands")).toHaveTextContent("Rep 4 of 4");
    // Left of the limit, and the day it ends, as the test's name has always said.
    expect(tile("Allowance")).toHaveTextContent(/^\$3\.74 left of \$5\.00 in this allowance, until .*2026$/);
    expect(tile("Spent training")).toHaveTextContent("$1.73");
    expect(screen.getByText(/not playing right now/i)).toBeInTheDocument();
  });

  /** All true, and none of it said whether the agent was any good. Its place among the others is that answer. */
  test("says where it stands among the others, and how many records it holds", async () => {
    const table: StandingsWire = { more: 3, best: [], agents: [
      { identity: "1", rep: 9, ranked: [], holds: [], runs: 1, lastRunAt: 1 },
      { identity: "894767", rep: 4, ranked: ["liar", "toll"], holds: ["toll"], runs: 2, lastRunAt: 1 },
    ] };
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent()], more: 0, partial: false }, table));
    show(page);
    // Second of the two listed and the three that are not.
    const place = await screen.findByRole("link", { name: "2nd of 5 agents" });
    expect(place).toHaveAttribute("href", "/#standings");
    expect(tile("Solved and recorded")).toHaveTextContent("2 of 2 exercises");
    expect(tile("Solved and recorded")).toHaveTextContent("Holds the record on 1");
  });

  /**
   * Not read is not absent. While the standings loaded, or where the gym would not give them, an
   * agent at the top of them was told it was "not on the standings yet" and held no record.
   */
  test("until the standings are read, its place is unread: not a claim that it has none", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent()], more: 0, partial: false }));
    show(page);
    await screen.findByRole("heading", { name: "Agent #894767" });
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith("/standings", expect.anything()));
    expect(tile("Where it stands")).toHaveTextContent(/^unreadRep 4 of 4$/);
    expect(screen.queryByText("not on the standings yet")).not.toBeInTheDocument();
    // What it has recorded is the registry's to say, and is said. Which records it holds is the standings', and is not.
    expect(tile("Solved and recorded")).toHaveTextContent(/^2 of 2 exercises$/);
  });

  test("an agent with a recorded solve that the gym does not list is past the ones it lists, not off the standings", async () => {
    const table: StandingsWire = { more: 7, best: [], agents: [{ identity: "1", rep: 9, ranked: [], holds: [], runs: 1, lastRunAt: 1 }] };
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent()], more: 0, partial: false }, table));
    show(page);
    await waitFor(() => expect(tile("Where it stands")).toHaveTextContent("past the first 1"));
    expect(screen.queryByText("not on the standings yet")).not.toBeInTheDocument();
    expect(tile("Solved and recorded")).toHaveTextContent(/^2 of 2 exercises$/);
  });

  test("an agent with nothing recorded is not on the standings, and is not given a place", async () => {
    const table: StandingsWire = { more: 0, best: [], agents: [{ identity: "1", rep: 9, ranked: [], holds: [], runs: 1, lastRunAt: 1 }] };
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ rep: 0, ranked: [] })], more: 0, partial: false }, table));
    show(page);
    await waitFor(() => expect(tile("Where it stands")).toHaveTextContent("not on the standings yet"));
    expect(tile("Where it stands")).toHaveTextContent("Rep 0 of 4");
    expect(tile("Solved and recorded")).toHaveTextContent("0 of 2 exercises");
    expect(tile("Solved and recorded")).toHaveTextContent("Holds no record");
    expect(screen.queryByRole("link", { name: /of \d+ agents?$/ })).not.toBeInTheDocument();
  });

  test("its best on each exercise is its cheapest solve, easiest exercise first, and says what is recorded", async () => {
    const runs = [
      run("a1", { problem: "liar", solved: true, endedBy: "solved", spend: "0.400000", probes: 20, ranked: true }),
      run("a2", { problem: "liar", solved: true, endedBy: "solved", spend: "0.280000", probes: 14 }),
      run("a3", { problem: "toll", solved: false, endedBy: "refused", spend: "0.020000", probes: 1 }),
    ];
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ runs, ranked: ["liar"] })], more: 0, partial: false }));
    show(page);
    const best = within(await screen.findByRole("region", { name: "Its best on each exercise" })).getAllByRole("row").slice(1);
    // Toll is easy and Liar hard, so Toll is first though the gym lists Liar first.
    expect(best.map((r) => r.textContent)).toEqual(["Tolleasynot solved yet", "Liarrecordedhard$0.2814"]);
    expect(within(best[1]!).getByRole("link", { name: "Liar" })).toHaveAttribute("href", "/#exercises/liar");
  });

  /** Rep is counted from the registry, so the registry is what says an exercise is recorded. */
  test("an exercise the registry says is recorded is marked so, whatever runs this gym has of it", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ runs: [], ranked: ["toll"] })], more: 0, partial: false }));
    show(page);
    const best = within(await screen.findByRole("region", { name: "Its best on each exercise" })).getAllByRole("row").slice(1);
    // Recorded, and its cost not known here: not "not solved yet", which would contradict it.
    expect(best.map((r) => r.textContent)).toEqual(["Tollrecordedeasy", "Liarhardnot solved yet"]);
  });

  test("with the registry unread, a run this gym recorded still marks its exercise", async () => {
    const runs = [run("a1", { problem: "liar", solved: true, endedBy: "solved", ranked: true })];
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ runs, ranked: [], rep: null, repUnread: true })], more: 0, partial: false }));
    show(page);
    const best = within(await screen.findByRole("region", { name: "Its best on each exercise" })).getAllByRole("row").slice(1);
    expect(best[1]).toHaveTextContent(/^Liarrecorded/);
    expect(best[0]).not.toHaveTextContent("recorded");
  });

  /** It said "$0.35, 2 gigs won, paid to your wallet" of a wallet that had been paid $0.10, while Gigs said $0.10. */
  test("what it has earned is what has been paid, and a win still paying out is said beside it", async () => {
    const won = [{ id: "b1", title: "One", amount: "0.100000", awardTx: "0x1" }, { id: "b2", title: "Two", amount: "0.250000", awardTx: null }];
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ won })], more: 0, partial: false }));
    show(page);
    await screen.findByRole("heading", { name: "Agent #894767" });
    expect(tile("Earned from gigs")).toHaveTextContent(/^\$0\.101 gig won, paid to your wallet\. 1 more is paying out\.$/);
  });

  test("with every win paid it adds them up, and with none it says nothing has been paid", async () => {
    const won = [{ id: "b1", title: "One", amount: "0.100000", awardTx: "0x1" }, { id: "b2", title: "Two", amount: "0.250000", awardTx: "0x2" }];
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ won }), agent({ address: "0x00000000000000000000000000000000000000aa", identity: "7" })], more: 0, partial: false }));
    show(page);
    await screen.findByRole("heading", { name: "Agent #894767" });
    const [first, second] = screen.getAllByText("Earned from gigs").map((dt) => dt.nextElementSibling!);
    expect(first).toHaveTextContent(/^\$0\.352 gigs won, paid to your wallet\.$/);
    expect(second).toHaveTextContent(/^\$0\.00Nothing paid yet\.$/);
  });

  test("an idle agent says what it last did, and can be sent to train again", async () => {
    const runs = [run("a9", { problem: "toll", endedBy: "solved", solved: true, startedAt: Date.now() - 2 * 3_600_000 }), run("a1")];
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ runs })], more: 0, partial: false }));
    show(page);
    expect(await screen.findByText("Resting. Its last run was Toll, 2h ago.")).toBeInTheDocument();
    expect(tile("Spent training")).toHaveTextContent("Over 2 runs, in all");
  });

  /**
   * Training is one sentence said to the agent. The button went to the set-up page, where every step
   * was ticked and faded and the sentence was the fourth of five.
   */
  test("sending it to train again is the sentence, with this gym in it, to copy where the owner is", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent()], more: 0, partial: false }));
    show(page);
    const again = await screen.findByRole("button", { name: "Send it to train again" });
    expect(again).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/^Train on Bench at/)).not.toBeInTheDocument();
    await user.click(again);
    expect(again).toHaveAttribute("aria-expanded", "true");
    const said = document.getElementById(again.getAttribute("aria-controls")!)!;
    expect(within(said).getByText(`Train on Bench at ${GYM}: solve and record as many exercises as you can, and spend as little as you can.`)).toBeInTheDocument();
    expect(within(said).getByRole("button", { name: /copy the sentence for your agent/i })).toBeInTheDocument();
    await user.click(again);
    expect(screen.queryByText(/^Train on Bench at/)).not.toBeInTheDocument();
  });

  /** The owner's runs say what was paid; the standings say what solving cost. The same run read $0.32 and $0.07 under one word. */
  test("the runs say what was paid for each, and say so where that includes recording", async () => {
    const recorded = run("a1", { endedBy: "solved", solved: true, ranked: true, spend: "0.070000", paid: "0.320000" });
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ runs: [recorded] })], more: 0, partial: false }));
    const { unmount } = show(page);
    await screen.findByRole("heading", { name: "Agent #894767" });
    expect(within(runsTable()).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Exercise", "Result", "Questions", "Paid", "When"]);
    expect(screen.getByText(/^Paid includes the \$0\.25 to record a solve/)).toBeInTheDocument();
    unmount();
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ runs: [run("a2")] })], more: 0, partial: false }));
    show(page);
    await screen.findByRole("heading", { name: "Agent #894767" });
    expect(screen.queryByText(/^Paid includes/)).not.toBeInTheDocument();
  });

  test("the allowance can be changed where it was granted, in the wallet", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent()], more: 0, partial: false }));
    show(page);
    expect(await screen.findByRole("link", { name: "Change or revoke it in the wallet" })).toHaveAttribute("href", MANDATE);
    // 3.745 of 5 is left, drawn as that share of the bar.
    expect(document.querySelector<HTMLElement>(".allowance-bar span")!.style.width).toBe("74.9%");
  });

  test("an allowance that has ended or been used up draws no bar of what is left", async () => {
    const ended = { limit: "5.000000", used: "1.000000", remaining: "4.000000", validUntil: 1, live: false };
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ allowance: ended })], more: 0, partial: false }));
    show(page);
    await screen.findByRole("heading", { name: "Agent #894767" });
    expect(tile("Allowance")).toHaveTextContent("ended or used up");
    expect(document.querySelector(".allowance-bar")).toBeNull();
  });

  describe("what next", () => {
    const next = async (over: Partial<OwnerAgentWire>) => {
      vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent(over)], more: 0, partial: false }));
      show(page);
      await screen.findByRole("heading", { name: "Agent #894767" });
      await screen.findByRole("link", { name: "Toll" });
      return screen.queryByText("What next")?.nextElementSibling ?? null;
    };

    test("an agent that has never played is pointed at the sentence", async () => {
      const said = await next({ runs: [], ranked: [], rep: null });
      expect(said).toHaveTextContent("It has not played yet. Give it the sentence on Start.");
      expect(within(said as HTMLElement).getByRole("link", { name: "Start" })).toHaveAttribute("href", "/fund");
    });

    test("one that has played and recorded nothing is told what recording is for", async () => {
      expect(await next({ runs: [run("a1")], ranked: [], rep: 0 })).toHaveTextContent(/recorded nothing, so it has no rep/);
    });

    test("one with exercises still to record is told which", async () => {
      expect(await next({ runs: [run("a1")], ranked: ["liar"], rep: 3 })).toHaveTextContent("Still to record: Toll. Each one it records adds rep.");
    });

    test("one that has recorded them all is told rep cannot go higher, and what is left", async () => {
      const said = await next({ runs: [run("a1")] });
      expect(said).toHaveTextContent(/recorded every exercise, so it cannot earn more rep/);
      expect(within(said as HTMLElement).getByRole("link", { name: "gigs" })).toHaveAttribute("href", "/#gigs");
    });

    test("nothing is suggested for an agent the wallet does not grant to, or whose rep could not be read", async () => {
      expect(await next({ current: false, allowance: null, runs: [run("a1")] })).toBeNull();
    });
  });

  /** The gap this page exists for: after step 4 nothing showed what the agent was doing. */
  test("a run being played shows live, with its questions and what it has cost so far", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ live: run("a20"), runs: [run("a20")] })], more: 0, partial: false }));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" gym={GYM} walletUrl={MANDATE} />);
    expect(await screen.findByText(/playing liar now: 7 questions/i)).toBeInTheDocument();
  });

  test("names the gigs an agent already qualifies for, and how to enter", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ qualifies: ["b3"] })], more: 0, partial: false }));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" gym={GYM} walletUrl={MANDATE} />);
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
    render(<QueryClientProvider client={queries}><Yours wallet={WALLET} offer={offer} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" gym={GYM} walletUrl={MANDATE} /></QueryClientProvider>);
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
        <Yours wallet={wallet} offer={offer} connect={connect} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" gym={GYM} walletUrl={MANDATE} />
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
    show(<Yours wallet="" offer={() => {}} connect={() => {}} onConnect={onConnect} connectHref="#stay" explorer="https://arcscan.app" gym={GYM} walletUrl={MANDATE} />);
    await user.click(screen.getByRole("link", { name: "Connect wallet" }));
    expect(onConnect).toHaveBeenCalled();
  });

  test("a page the chain would not wholly give says it may not be everything", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent()], more: 0, partial: true }));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" gym={GYM} walletUrl={MANDATE} />);
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
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" gym={GYM} walletUrl={MANDATE} />);
    expect(await screen.findByText(/since you last looked/i)).toHaveTextContent("1 run, $0.30 spent");
    expect(screen.getAllByText("new")).toHaveLength(1);
  });

  test("rep the registry would not give is said to be unread, not none", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ rep: null, repUnread: true, ranked: [] })], more: 0, partial: false }));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" gym={GYM} walletUrl={MANDATE} />);
    await screen.findByRole("heading", { name: "Agent #894767" });
    expect(tile("Where it stands")).toHaveTextContent(/^unread$/);
    // What it has recorded comes from the same reading: unread too, and not "0 of 2".
    expect(tile("Solved and recorded")).toHaveTextContent(/^unread$/);
    expect(screen.queryByText("none yet")).not.toBeInTheDocument();
    expect(screen.queryByText("not on the standings yet")).not.toBeInTheDocument();
    // And nothing is suggested from a number that was not read.
    expect(screen.queryByText("What next")).not.toBeInTheDocument();
  });

  /** "Revoked" was said of any agent the wallet does not grant to, one it never granted to included. */
  test("an agent the wallet does not grant to is shown without claiming it was revoked", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ current: false, allowance: null })], more: 0, partial: false }));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" gym={GYM} walletUrl={MANDATE} />);
    expect((await screen.findByText("Allowance")).nextSibling).toHaveTextContent("none now");
    expect(screen.getByText(/does not grant it an allowance now/i)).toBeInTheDocument();
    expect(screen.queryByText(/revoked/i)).not.toBeInTheDocument();
    // It cannot spend from this wallet, so there is nothing to send it to do.
    expect(screen.queryByRole("button", { name: "Send it to train again" })).not.toBeInTheDocument();
  });

  test("a wallet with more agents than one page carries says how many are not shown", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent()], more: 5, partial: false }));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" gym={GYM} walletUrl={MANDATE} />);
    expect(await screen.findByText("5 more agents of this wallet are not shown.")).toBeInTheDocument();
  });

  test("a wallet with no agents says so and points to setting one up", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [], more: 0, partial: false }));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" gym={GYM} walletUrl={MANDATE} />);
    expect(await screen.findByText(/has not granted an allowance/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /set up your agent/i })).toBeInTheDocument();
  });

  test("without a wallet it offers to connect one, and still takes a pasted address", () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [], more: 0, partial: false }));
    show(<Yours wallet="" offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" gym={GYM} walletUrl={MANDATE} />);
    expect(screen.getByRole("link", { name: "Connect wallet" })).toHaveAttribute("href", CONNECT);
    expect(screen.getByLabelText(/or paste your wallet's address/i)).toBeInTheDocument();
  });

  test("without a wallet it says where the link comes from, and asks for the address", () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [], more: 0, partial: false }));
    show(<Yours wallet="" offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={null} explorer="https://arcscan.app" gym={GYM} walletUrl={MANDATE} />);
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
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" gym={GYM} walletUrl={MANDATE} />);
    const line = await screen.findByText(/since you last looked/i);
    expect(line).toHaveTextContent("Since you last looked: 1 run, $0.39 spent, 1 recorded.");
    // And its row says the same $0.39, not the $0.14 the run scored.
    expect(within(runsTable()).getAllByRole("row")[1]).toHaveTextContent("$0.39");
  });

  /** On a phone the list stops at three. The button said "See all 8 runs" and counted the wrong thing. */
  test("runs past the third are held back until asked for, and the button says how many", async () => {
    const user = userEvent.setup();
    const five = ["a5", "a4", "a3", "a2", "a1"].map((id, i) => run(id, { startedAt: Date.now() - (i + 1) * 60_000 }));
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ runs: five })], more: 0, partial: false }));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" gym={GYM} walletUrl={MANDATE} />);
    const more = await screen.findByRole("button", { name: "Show 2 more runs" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    // What it says it controls is the table it controls.
    expect(document.getElementById(more.getAttribute("aria-controls")!)).toBe(runsTable());
    const rows = () => within(runsTable()).getAllByRole("row").slice(1);
    expect(rows().map((r) => r.className)).toEqual(["", "", "", "extra", "extra"]);
    await user.click(more);
    expect(rows().map((r) => r.className)).toEqual(["", "", "", "", ""]);
    // The same button, now the way back, so focus is not lost with it.
    expect(screen.getByRole("button", { name: "Show fewer runs" })).toHaveAttribute("aria-expanded", "true");
  });

  test("three runs or fewer need no button", async () => {
    vi.stubGlobal("fetch", serving({ wallet: WALLET, agents: [agent({ runs: [run("a1"), run("a2"), run("a3")] })], more: 0, partial: false }));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" gym={GYM} walletUrl={MANDATE} />);
    await screen.findByRole("heading", { name: "Agent #894767" });
    expect(screen.queryByRole("button", { name: /more run/i })).not.toBeInTheDocument();
  });

  test("a read that fails is said, not shown as an empty wallet", async () => {
    vi.stubGlobal("fetch", serving(500));
    show(<Yours wallet={WALLET} offer={() => {}} connect={() => {}} onConnect={() => {}} connectHref={CONNECT} explorer="https://arcscan.app" gym={GYM} walletUrl={MANDATE} />);
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
