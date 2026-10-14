import { afterEach, describe, expect, test, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { render } from "../strings.tsx";
import { MAINNET, NETWORKS, TESTNET, on } from "../network.ts";
import type { ProblemDetailWire, ScoreWire } from "../../../src/shared/wire.ts";
import { BOARD_PLACES, Leaderboard } from "../../src/train/Leaderboard.tsx";
import { ExerciseCard } from "../../src/train/ExerciseCard.tsx";
import { Readout } from "../../src/train/demo/Readout.tsx";
import { BlackBoxField } from "../../src/train/demo/BlackBoxField.tsx";
import { Hero } from "../../src/train/demo/Hero.tsx";
import { planBoard, RAYS_PER_BOARD } from "../../src/train/demo/plan.ts";
import { frameAt, lengthOf } from "../../src/train/demo/timeline.ts";

const PAYER = "0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce";
const PRICE = 20_000;
const score = (attempt: string, spend: string, over: Partial<ScoreWire> = {}): ScoreWire => ({
  attempt, agent: `agent-${attempt}`, payer: null, identity: null, problem: "toll", seed: "s", fingerprint: "0x",
  solved: true, spend, probes: 3, submissions: 1, wallTimeMs: 1, endedBy: "solved", ranked: false, ...over,
});

beforeEach(() => { vi.restoreAllMocks(); });

describe("a leaderboard", () => {
  test("is named for its exercise, and each row has its place, who, how many questions, whether recorded, and the cost", () => {
    render(<Leaderboard title="Toll" rows={[score("a", "0.060000", { ranked: true, payer: PAYER, probes: 3 })]} />);
    const board = screen.getByRole("region", { name: "Toll leaderboard" });
    const row = within(board).getByRole("listitem");
    expect(row.querySelector(".place")).toHaveTextContent("01");
    expect(row.querySelector(".who")).toHaveTextContent("agent-a");
    expect(row.querySelector(".proof")).toHaveTextContent("paid by 0x3535…61Ce");
    expect(row.querySelector(".probes")).toHaveTextContent("3 questions");
    expect(row.querySelector(".mark")).toHaveClass("ranked");
    expect(row.querySelector(".cost")).toHaveTextContent("$0.06");
  });

  test("a run with no payer named says nothing of who paid", () => {
    render(<Leaderboard title="Toll" rows={[score("a", "0.060000")]} />);
    expect(document.querySelector(".proof")).toBeNull();
  });

  test("one question is not pluralised", () => {
    render(<Leaderboard title="Toll" rows={[score("a", "0.020000", { probes: 1 })]} />);
    expect(document.querySelector(".probes")).toHaveTextContent(/^1 question$/);
  });

  test(`shows at most ${BOARD_PLACES} places`, () => {
    const rows = Array.from({ length: BOARD_PLACES + 3 }, (_, i) => score(`r${i}`, `0.0${String(i + 10)}000`));
    render(<Leaderboard title="Toll" rows={rows} />);
    const shown = screen.getAllByRole("listitem");
    expect(shown).toHaveLength(BOARD_PLACES);
    expect(shown.at(-1)!.querySelector(".place")).toHaveTextContent(String(BOARD_PLACES));
  });

  test("an empty board names its exercise and says what would fill it", () => {
    render(<Leaderboard title="Toll" rows={[]} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByText(/nobody has solved Toll with money on the line yet/i)).toBeInTheDocument();
  });
});

describe("an exercise's card", () => {
  const toll: ProblemDetailWire = {
    id: "toll", title: "Toll", category: "search", level: "easy", summary: "s", par: 1,
    prices: { ask: "0.020000", submit: "0.050000", rank: "0.250000" }, statement: "Find the gate.", scoring: "cost",
  };
  const stat = (label: string) => screen.getByText(label).nextSibling;

  test("states the rule, the level, the fewest questions, and every price, from the gym's own figures", () => {
    render(<ExerciseCard problem={toll} />);
    expect(screen.getByRole("heading", { level: 2, name: "Toll" })).toBeInTheDocument();
    expect(screen.getByText("Find the gate.")).toBeInTheDocument();
    expect(screen.getByText("easy")).toHaveClass("level-tag", "easy");
    expect(screen.getByText("search")).toBeInTheDocument();
    expect(stat("Fewest needed")).toHaveTextContent("1 question");
    expect(stat("That costs")).toHaveTextContent("$0.02");
    expect(stat("Per question")).toHaveTextContent("$0.02");
    expect(stat("To record a solve")).toHaveTextContent("$0.25");
  });

  test.each(NETWORKS)("on %s with the wallet, an agent is sent to the skill", (_name, network) => {
    render(<ExerciseCard problem={toll} />, { network: on(network, { walletUrl: "https://kuiralabs.github.io/mandate/" }) });
    const how = screen.getByText(/through the Bench skill/).closest("p")!;
    expect(within(how).getByRole("link", { name: "Start" })).toHaveAttribute("href", "/fund");
  });

  test("where no wallet serves the network, an agent needs a key of its own", () => {
    render(<ExerciseCard problem={toll} />, { network: on(MAINNET, { walletUrl: null }) });
    expect(screen.getByText(/on this network that takes a key of its own/i)).toBeInTheDocument();
    expect(screen.queryByText(/skill/i)).not.toBeInTheDocument();
  });
});

describe("the demo's parts", () => {
  /** Boards that end each way, found by playing them, so the test does not depend on one seed's luck. */
  const seeds = Array.from({ length: 200 }, (_, i) => i + 1);
  const solvedSeed = seeds.find((s) => planBoard(s, PRICE).solved)!;
  const refusedSeed = seeds.find((s) => !planBoard(s, PRICE).solved)!;
  const ended = (seed: number) => { const plan = planBoard(seed, PRICE); return { plan, frame: frameAt(plan, lengthOf(plan) - 2_000) }; };

  test("before the first question, the readout shows nothing bought, the whole budget, and that it is solving", () => {
    const plan = planBoard(solvedSeed, PRICE);
    render(<Readout seed={42} frame={frameAt(plan, 0)} atoms={plan.board.atoms.length} budget={RAYS_PER_BOARD} price={PRICE} />);
    expect(screen.getByText("Puzzle").nextSibling).toHaveTextContent("0042");
    expect(screen.getByText("Questions").nextSibling).toHaveTextContent(`0/${RAYS_PER_BOARD}`);
    expect(document.querySelectorAll(".bar i.on")).toHaveLength(RAYS_PER_BOARD);
    expect(screen.getByText("Spent").nextSibling).toHaveTextContent("$0.00");
    expect(screen.getByText("Solving")).toBeInTheDocument();
  });

  test("a solved board says the rep it earns once recorded, and what it cost", () => {
    const { plan, frame } = ended(solvedSeed);
    render(<Readout seed={solvedSeed} frame={frame} atoms={plan.board.atoms.length} budget={RAYS_PER_BOARD} price={PRICE} />);
    const verdict = document.querySelector(".verdict")!;
    expect(verdict).toHaveClass("solved");
    expect(verdict).toHaveTextContent(/Solved · \+\d+ rep/);
    expect(verdict).toHaveTextContent(`$${(frame.bought * PRICE / 1_000_000).toFixed(2)}`);
    expect(verdict).toHaveTextContent(/once recorded, for \$0\.25/);
    expect(document.querySelectorAll(".bar i.on")).toHaveLength(RAYS_PER_BOARD - frame.bought);
  });

  test("a board the money ran out on says it earned nothing, and the drawing is cut off", () => {
    const { plan, frame } = ended(refusedSeed);
    render(<>
      <BlackBoxField size={plan.board.size} frame={frame} price="$0.02" />
      <Readout seed={refusedSeed} frame={frame} atoms={plan.board.atoms.length} budget={RAYS_PER_BOARD} price={PRICE} />
    </>);
    expect(document.querySelector(".verdict")).toHaveTextContent(/Ran out · no rep.*spent for nothing/);
    expect(document.querySelector(".holo")).toHaveClass("flatline");
    expect(document.querySelectorAll(".bar i.on")).toHaveLength(0);
  });

  test("the grid says, to a screen reader, how many questions were asked and atoms found", () => {
    const { plan, frame } = ended(solvedSeed);
    render(<BlackBoxField size={plan.board.size} frame={frame} price="$0.02" />);
    const grid = screen.getByRole("img", { name: /^The Black Box grid\./ });
    expect(grid).toHaveAccessibleName(new RegExp(`${frame.bought} questions? asked, ${frame.found.length} atoms? found`));
    expect(document.querySelector(".holo")).toHaveClass("breached");
  });
});

describe("the demo, as a still frame", () => {
  afterEach(() => { window.history.replaceState(null, "", "/"); });
  const still = (board: number, at: number) => {
    window.history.replaceState(null, "", `/?board=${board}&at=${at}`);
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  };

  test("says it is a demo before anything moves, with the gym's price and the board asked for", () => {
    still(42, 0);
    render(<Hero probePrice="0.020000" />, { network: TESTNET });
    const demo = screen.getByRole("region", { name: "A demonstration of the Black Box exercise" });
    expect(within(demo).getByText("Demo · simulated agent")).toBeInTheDocument();
    expect(within(demo).getByText(/\$0\.02 each/)).toBeInTheDocument();
    expect(within(demo).getByRole("link", { name: "See its leaderboard" })).toHaveAttribute("href", "/#exercises/blackbox");
    expect(within(demo).getByText("Puzzle").nextSibling).toHaveTextContent("0042");
    expect(within(demo).getByText("Watching the agent pick its first question…")).toBeInTheDocument();
  });

  test("a frame after a question narrates it, numbered, from its side", () => {
    const plan = planBoard(42, PRICE);
    const at = lengthOf(plan) - 2_000;
    still(42, at);
    render(<Hero probePrice="0.020000" />, { network: TESTNET });
    const n = frameAt(plan, at).narration!;
    const narration = document.querySelector(".narration")!;
    expect(narration).toHaveAttribute("aria-live", "polite");
    expect(narration).toHaveClass(n.tone);
    expect(narration).toHaveTextContent(new RegExp(`^Question ${n.n} from the (top|bottom|left|right)\\. `));
  });
});
