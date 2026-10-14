import { openHints } from "../hints.ts";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { render } from "../strings.tsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BestWire, ProblemWire, StandingsWire, StandingWire } from "../../../src/shared/wire.ts";
import { Standings } from "../../src/rep/Standings.tsx";
import { ExerciseList } from "../../src/train/ExerciseList.tsx";

const PRICES = { ask: "0.020000", submit: "0.050000", rank: "0.250000" };
const problem = (id: string, title: string, level: ProblemWire["level"], par: number | null): ProblemWire =>
  ({ id, title, category: `the ${id} skill`, level, summary: `What ${title} is.`, par, prices: PRICES });
/** In the order the page shows them: easiest first. */
const PROBLEMS = [problem("toll", "Toll", "easy", 1), problem("codebreaker", "Codebreaker", "medium", 4), problem("liar", "Liar", "hard", 14)];
const standing = (identity: string, over: Partial<StandingWire> = {}): StandingWire =>
  ({ identity, rep: 1, ranked: ["toll"], holds: [], runs: 2, lastRunAt: Date.now() - 2 * 86_400_000, ...over });
const best = (problem: string, identity: string, spend: string, probes: number): BestWire =>
  ({ problem, identity, spend, probes, attempt: `a-${problem}` });

function show(node: React.ReactNode) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queries}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
});

describe("the standings", () => {
  const page = (table: StandingsWire | undefined, over: { mine?: string[]; failed?: boolean } = {}) => show(
    <Standings table={table} failed={over.failed ?? false} problems={PROBLEMS} mine={over.mine ?? []} runs={[]}
               looking="" />);
  const TABLE: StandingsWire = {
    agents: [
      standing("894767", { rep: 6, ranked: ["toll", "codebreaker", "liar"], holds: ["toll", "liar"], runs: 15, lastRunAt: Date.now() - 3 * 3_600_000 }),
      standing("896922"),
    ],
    // As the gym lists them, which is not the order the page shows them in.
    best: [best("liar", "894767", "0.280000", 14), best("toll", "894767", "0.020000", 1)],
    more: 0,
  };
  const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);

  test("lists the agents in the gym's order, each with its place, rep, what it recorded and the records it holds", () => {
    page(TABLE);
    expect(rows().map((r) => within(r).getAllByRole("cell").map((c) => c.textContent))).toEqual([
      ["1", "Agent #894767", "6", "3 of 3", "2", "15", "3h ago"],
      ["2", "Agent #896922", "1", "1 of 3", "0", "2", "2d ago"],
    ]);
  });

  test("says how rep is earned and what splits agents level on it, from the gym's own weights", () => {
    page(TABLE);
    openHints();
    expect(screen.getByText(/1 for an easy one, 2 for a medium, 3 for a hard, 6 in all/)).toBeInTheDocument();
    expect(screen.getByText(/level on rep are split by how many records they hold/)).toBeInTheDocument();
  });

  test("the connected wallet's agent is marked as theirs, and only that one", () => {
    page(TABLE, { mine: ["896922"] });
    expect(rows().map((r) => r.className)).toEqual(["", "mine"]);
    expect(within(rows()[1]!).getByText("your agent")).toBeInTheDocument();
    expect(screen.getAllByText("your agent")).toHaveLength(1);
  });

  test("each agent links to its rep, looked up", () => {
    page(TABLE);
    expect(screen.getByRole("link", { name: "Agent #896922" })).toHaveAttribute("href", "/#standings/896922");
  });

  test("the record on each exercise is beside it, easiest first, each a link to its exercise", () => {
    page(TABLE);
    const records = within(screen.getByRole("complementary", { name: /records/i })).getAllByRole("link");
    expect(records.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Toll agent #894767$0.02", "/#exercises/toll"],
      ["Liar agent #894767$0.28", "/#exercises/liar"],
    ]);
  });

  /** Before the gym has said what its exercises are there is no total to set a count against: not "7 of 0". */
  test("until the exercises are known it gives what each has recorded as a count, and no total", () => {
    show(<Standings table={TABLE} failed={false} problems={[]} mine={[]} runs={[]} looking="" />);
    expect(rows().map((r) => within(r).getAllByRole("cell")[3]!.textContent)).toEqual(["3", "1"]);
    openHints();
    expect(screen.queryByText(/in all/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 for an easy one, 2 for a medium, 3 for a hard\. Agents level on rep/)).toBeInTheDocument();
  });

  /** A link to one agent's rep opened on a page that showed everyone but them: their answer was a screen below. */
  test("somebody looked up from outside the table is shown above it; with nobody, the lookup is a form under it", () => {
    const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const show_ = (looking: string) => show(
      <Standings table={TABLE} failed={false} problems={PROBLEMS} mine={[]} runs={[]} looking={looking} />);
    const first = show_("999");
    expect(before(screen.getByRole("region", { name: "Look up an agent's rep" }), screen.getByRole("table"))).toBe(true);
    first.unmount();
    show_("");
    expect(before(screen.getByRole("table"), screen.getByRole("region", { name: "Look up an agent's rep" }))).toBe(true);
    expect(screen.getAllByRole("region", { name: "Look up an agent's rep" })).toHaveLength(1);
  });

  /** Pressing an agent moved the look-up box above the table, with the answer in it, a screen away from the press. */
  test("an agent pressed in the table opens under its own row, the form stays put, and pressing it again closes it", () => {
    const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    show(<Standings table={TABLE} failed={false} problems={PROBLEMS} mine={[]} runs={[]} looking="894767" />);
    const name = screen.getByRole("link", { name: "Agent #894767" });
    expect(name).toHaveAttribute("aria-expanded", "true");
    expect(name).toHaveAttribute("href", "/#standings");
    const opened = name.closest("tr")!.nextElementSibling!;
    expect(opened).toHaveClass("agent-open");
    expect(within(opened as HTMLElement).getByRole("link", { name: "Close" })).toHaveAttribute("href", "/#standings");
    expect(before(screen.getByRole("table"), screen.getByRole("region", { name: "Look up an agent's rep" }))).toBe(true);
  });

  test("it says what splits agents level on rep and on records too", () => {
    page(TABLE);
    openHints();
    expect(screen.getByText(/split by how many records they hold, and then by which got there first/)).toBeInTheDocument();
  });

  test("it says how many are on it, counting the ones not shown, and how to join", () => {
    page({ ...TABLE, more: 40 });
    expect(screen.getByText("40 more agents are not shown.")).toBeInTheDocument();
    expect(screen.getByText(/^42 agents so far\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up your agent" })).toHaveAttribute("href", "/fund");
  });

  test("with nobody on it yet it says so, and what would put the first one there", () => {
    page({ agents: [], best: [], more: 0 });
    expect(screen.getByText(/no agent has recorded a solve yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  /** Not read is not empty: "no agent has recorded a solve" would be a claim about the gym. */
  test("while it is being read, and when it cannot be, it does not claim the gym is empty", () => {
    const { unmount } = page(undefined);
    expect(screen.queryByText(/no agent has recorded a solve yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/could not be read/i)).not.toBeInTheDocument();
    unmount();
    page(undefined, { failed: true });
    expect(screen.getByText(/the standings could not be read just now/i)).toBeInTheDocument();
    expect(screen.queryByText(/no agent has recorded a solve yet/i)).not.toBeInTheDocument();
  });

  /** A poll that fails after a good one leaves the last good table up rather than an error over it. */
  test("a failed refresh keeps the table it already has", () => {
    page(TABLE, { failed: true });
    expect(rows()).toHaveLength(2);
    expect(screen.queryByText(/could not be read just now/i)).not.toBeInTheDocument();
  });
});

describe("the list of exercises", () => {
  const list = (records: BestWire[], mine: string[] = []) =>
    show(<ExerciseList problems={PROBLEMS} best={records} mine={mine} demoHref="/#exercises/blackbox/demo" />);
  const row = (title: string) => screen.getByRole("heading", { level: 3, name: title }).closest("li")!;

  test("says what each is and what it tests, how hard, and what recording it adds", () => {
    list([]);
    expect(row("Toll")).toHaveTextContent("What Toll is. Tests the toll skill.");
    expect(row("Toll")).toHaveTextContent(/Level\s*easy\s*1 rep/);
    expect(row("Liar")).toHaveTextContent(/Level\s*hard\s*3 rep/);
  });

  test("says what things cost, from the gym's own prices", () => {
    list([]);
    // The two prices every run meets are in view; how answers are priced and what a record is worth, behind the "?".
    const prices = screen.getAllByRole("list")[0]!;
    expect(within(prices).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["$0.02 a question", "$0.25 to record a solve"]);
    openHints(document.querySelector(".price-line")!);
    const behind = document.querySelector(".price-line .explained")!;
    expect(behind).toHaveTextContent("An answer is free the first time on an exercise, then $0.05 for the next two, then double each time, so guessing gets dear");
    expect(behind).toHaveTextContent("Rep for a recorded solve: easy 1, medium 2, hard 3");
  });

  test("shows the record to beat on each, who holds it, and says so where nobody has set one", () => {
    list([best("toll", "894767", "0.020000", 1), best("codebreaker", "896922", "0.100000", 5)]);
    expect(row("Toll")).toHaveTextContent(/Record to beat\$0\.021 question, agent #894767/);
    expect(row("Codebreaker")).toHaveTextContent(/Record to beat\$0\.105 questions, agent #896922/);
    expect(row("Liar")).toHaveTextContent(/Record to beatnone yet/);
  });

  test("a record the connected wallet's agent holds is said to be theirs", () => {
    list([best("toll", "894767", "0.020000", 1), best("liar", "896922", "0.280000", 14)], ["894767"]);
    expect(row("Toll")).toHaveTextContent("your agent #894767");
    expect(row("Liar")).not.toHaveTextContent("your agent");
  });

  /** The canvas this was drawn from said "can be beaten" of an exercise with no proven fewest, which nobody knows. */
  test("says where the record stands against the fewest needed, and nothing where no fewest is proven", () => {
    const unproven = problem("zendo", "Zendo", "medium", null);
    show(<ExerciseList problems={[...PROBLEMS, unproven]} mine={[]} demoHref="#" best={[
      best("toll", "1", "0.020000", 1), best("codebreaker", "1", "0.100000", 5), best("liar", "1", "0.260000", 13), best("zendo", "1", "0.240000", 12),
    ]} />);
    expect(row("Toll")).toHaveTextContent(/Fewest needed1 questionRecord is already the fewest$/);
    expect(row("Codebreaker")).toHaveTextContent(/Fewest needed4 questionsRecord can still be beaten$/);
    expect(row("Liar")).toHaveTextContent(/Fewest needed14 questionsRecord beat the fewest$/);
    expect(row("Zendo")).toHaveTextContent(/Fewest needednot known yet$/);
  });

  test("each row opens that exercise, and the demo is one press away", () => {
    list([]);
    // The title is the link, so it is named for the exercise and not for everything in its row.
    expect(within(row("Codebreaker")).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Codebreaker", "/#exercises/codebreaker"],
    ]);
    expect(screen.getByRole("link", { name: "Watch a demo run" })).toHaveAttribute("href", "/#exercises/blackbox/demo");
    expect(screen.getByRole("link", { name: /give it the sentence on start/i })).toHaveAttribute("href", "/fund");
  });
});
