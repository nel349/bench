import { describe, expect, test, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { render } from "../strings.tsx";
import { MAINNET, TESTNET, on } from "../network.ts";
import type { Network } from "../../src/shared/network/network.ts";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "../../src/shared/chain/config.ts";
import { SetUp } from "../../src/setup/SetUp.tsx";
import type { FundsWire, OwnerWire } from "../../../src/shared/wire.ts";

const AGENT = "0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce";
const OTHER = "0x9fa928ACfE2eEcEad9698ebBad835E7129688b28";

const funds = (over: Partial<FundsWire> = {}): FundsWire => ({
  agent: AGENT, wallet: "0.030000", deposit: "0.500000", ready: true, probes: 25, ...over,
});

/** The server, scripted. Nothing here reaches one. */
function serving(byAddress: Record<string, FundsWire | 404>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const who = url.split("/").pop() ?? "";
    const found = byAddress[who];
    if (!found || found === 404) {
      return new Response(JSON.stringify({ error: "that is not an address" }), { status: 404 });
    }
    return new Response(JSON.stringify(found), { status: 200 });
  });
}

const WALLET = "https://kuiralabs.github.io/mandate/";
const GYM = "https://bench.example";
/** The network these pages are on: testnet, with the owner's wallet. */
const HERE = on(TESTNET, { walletUrl: WALLET });

function show(node: React.ReactNode, network: Network = HERE) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queries}>{node}</QueryClientProvider>
    </WagmiProvider>,
    { network },
  );
}

const page = (initialAgent: string | null) => <SetUp probePrice="0.020000" gym={GYM} initialAgent={initialAgent} />;

/** A balance of its own is the second way; a page opened without an agent in its link starts on the first. */
const toOwnKey = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /a balance of its own/i }));

beforeEach(() => { vi.restoreAllMocks(); });

describe("the front door", () => {
  test("asks for an address before anything else", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", serving({}));
    show(page(null));
    await toOwnKey(user);
    expect(screen.getByText(/checking it shows what it holds and moves no money/i)).toBeInTheDocument();
  });

  /**
   * It was one field, "the address your agent printed when it started", under a warning: it took an
   * agent, a key and what came next for granted. Now it says who it is for and sets out all three.
   */
  test("says who this way is for, what the agent needs, and what to do after, before it asks for anything", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", serving({}));
    show(page(null));
    await toOwnKey(user);
    expect(screen.getByText("For developers.")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "What your agent needs", "Add to its balance", "Send it to train",
    ]);
    expect(screen.getByRole("link", { name: "scripts/real-run.ts" })).toHaveAttribute("href", expect.stringContaining("github.com/nel349/bench"));
    expect(screen.getByText(/never the key itself/i)).toBeInTheDocument();
    expect(screen.getByText(`Train on Bench at ${GYM}: solve and record as many exercises as you can, and spend as little as you can.`)).toBeInTheDocument();
    // The warning about money that cannot come back belongs with the money, which is not on screen yet.
    expect(screen.queryByText(/this cannot be undone/i)).not.toBeInTheDocument();
  });

  test("the warning that it cannot be undone is said where the money is added", async () => {
    vi.stubGlobal("fetch", serving({ [AGENT]: funds({ probes: 25 }) }));
    show(page(AGENT));
    const add = (await screen.findByRole("group", { name: /how much to add/i })).closest(".give")!;
    expect(add).toHaveTextContent(/this cannot be undone/i);
  });

  test("a funded agent is told how many answers it can buy", async () => {
    vi.stubGlobal("fetch", serving({ [AGENT]: funds({ probes: 25 }) }));
    show(page(AGENT));
    expect(await screen.findByText(/can ask 25 questions/i)).toBeInTheDocument();
  });

  test("one answer is not pluralised", async () => {
    vi.stubGlobal("fetch", serving({ [AGENT]: funds({ probes: 1 }) }));
    show(page(AGENT));
    expect(await screen.findByText(/can ask 1 question\b/i)).toBeInTheDocument();
  });

  /**
   * The trap the page exists for: money in the wallet cannot buy anything, and an owner who sent it
   * to the right address and the wrong balance has to be told so.
   */
  test("money in the wallet is shown as unspendable, not as funds", async () => {
    vi.stubGlobal("fetch", serving({
      [AGENT]: funds({ wallet: "5.000000", deposit: "0.000000", ready: false, probes: 0 }),
    }));
    show(page(AGENT));
    expect(await screen.findByText(/empty\. it cannot ask anything yet/i)).toBeInTheDocument();
    expect(screen.getByText(/is not its balance and cannot pay for a question\. Only the agent can move it/i)).toBeInTheDocument();
    // The page never calls the place to put money "its wallet": that is the name of the mistake.
    expect(screen.getByText("At its address")).toBeInTheDocument();
    expect(screen.queryByText(/to its own wallet/i)).not.toBeInTheDocument();
  });

  test("an empty wallet says nothing needs to be there", async () => {
    vi.stubGlobal("fetch", serving({ [AGENT]: funds({ wallet: "0.000000" }) }));
    show(page(AGENT));
    expect(await screen.findByText(/nothing needs to be here/i)).toBeInTheDocument();
  });

  test("an address the server does not know is reported, not retried forever", async () => {
    vi.stubGlobal("fetch", serving({}));
    show(page(AGENT));
    expect(await screen.findByText(/not an address on this network/i)).toBeInTheDocument();
  });

  test("the irreversibility is stated where the buttons are", async () => {
    vi.stubGlobal("fetch", serving({ [AGENT]: funds() }));
    show(page(AGENT));
    expect(await screen.findByText(/cannot be undone/i)).toBeInTheDocument();
  });

  /**
   * The bug this test exists for: funding read the box while the balances described the checked
   * address, so editing the field without pressing Check would have sent money to one agent while
   * the page described another.
   */
  test("editing the address clears the result rather than describing the wrong agent", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", serving({ [AGENT]: funds({ probes: 25 }) }));
    show(page(AGENT));
    expect(await screen.findByText(/can ask 25 questions/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/your agent's address/i), "9");
    await waitFor(() => {
      expect(screen.queryByText(/can ask 25 questions/i)).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("group", { name: /how much to add/i })).not.toBeInTheDocument();
  });

  test("Check is refused until the address is one", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", serving({ [OTHER]: funds({ agent: OTHER }) }));
    show(page(null));
    await toOwnKey(user);
    const check = screen.getByRole("button", { name: /check/i });
    expect(check).toBeDisabled();
    await user.type(screen.getByLabelText(/your agent's address/i), OTHER);
    expect(check).toBeEnabled();
  });
});

describe("with an allowance, the way offered first", () => {
  /** The connector's steps, in its order. Step 1 differs for now: see `src/setup/steps.ts`. */
  test("the five steps, in order", () => {
    vi.stubGlobal("fetch", serving({}));
    show(page(null));
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual([
      "Open the wallet, and add test USDC phone",
      "Connect your agent laptop",
      "Scan to grant phone",
      "Tell your agent to play laptop",
      "Watch it spend, revoke any time phone",
    ]);
  });

  /**
   * Training is one sentence said to the agent. There was a Train tab with nothing on it to do, and
   * an owner who had set everything up did not know what came next: it was step 4 of five, in the
   * same grey as the rest.
   */
  test("the step that is the whole of training stands out, and only that one", () => {
    vi.stubGlobal("fetch", serving({}));
    show(page(null));
    const steps = [...document.querySelectorAll(".journey li")];
    expect(steps.map((li) => li.classList.contains("key"))).toEqual([false, false, false, true, false]);
    expect(steps[3]).toHaveTextContent(/this is the whole of training/i);
  });

  test("step 1 opens the owner's wallet", () => {
    vi.stubGlobal("fetch", serving({}));
    show(page(null));
    expect(screen.getByRole("link", { name: /open the wallet/i })).toHaveAttribute("href", WALLET);
  });

  test("step 4's sentence names this gym, and copies whole", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.stubGlobal("fetch", serving({}));
    show(page(null));

    const sentence = `Train on Bench at ${GYM}: solve and record as many exercises as you can, and spend as little as you can.`;
    expect(screen.getByText(sentence)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /copy the sentence for your agent/i }));
    expect(writeText).toHaveBeenCalledWith(sentence);
    expect(await screen.findByRole("button", { name: /copy the sentence/i })).toHaveTextContent("Copied");
  });

  test("no balance of its own is offered, and nothing says it cannot be undone", () => {
    vi.stubGlobal("fetch", serving({}));
    show(page(null));
    expect(screen.queryByLabelText(/your agent's address/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/cannot be undone/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/an allowance/i);
  });

  /** A link carrying an agent names a key, and the key is what a balance of its own is for. */
  test("a link naming an agent opens on its own key", async () => {
    vi.stubGlobal("fetch", serving({ [AGENT]: funds() }));
    show(page(AGENT));
    expect(screen.getByRole("button", { name: /a balance of its own/i })).toHaveAttribute("aria-pressed", "true");
    // The headline follows the way chosen, rather than promising an allowance beside a balance.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/a balance of its own/i);
    expect(await screen.findByText(/can ask 25 questions/i)).toBeInTheDocument();
  });

  /** Mainnet has no wallet yet. A testnet link there would open a wallet on the wrong network. */
  test("where no wallet serves the network, the allowance is not offered and the page says it is not here", () => {
    vi.stubGlobal("fetch", serving({}));
    show(page(null), on(TESTNET, { walletUrl: null }));
    expect(screen.queryByRole("button", { name: /with an allowance/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open the wallet/i })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The guided setup is not here yet.");
    // Nowhere to send anyone: this gym names no counterpart.
    expect(screen.queryByRole("link", { name: /set up on testnet/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/your agent's address/i)).toBeInTheDocument();
  });
});

/**
 * Step 1 makes the wallet, on the phone. The page asked a newcomer to connect one above it, and its
 * big button opened the wallet on the laptop.
 */
describe("step 1, which is on the phone", () => {
  test("a laptop is given the address to type there, and the button is kept for a phone", () => {
    vi.stubGlobal("fetch", serving({}));
    show(page(null));
    const address = screen.getByText("kuiralabs.github.io/mandate/");
    expect(address.closest(".laptop-only")).not.toBeNull();
    expect(screen.getByRole("link", { name: /open the wallet/i })).toHaveClass("phone-only");
    expect(screen.getByText(/mandate, a separate site/i)).toBeInTheDocument();
  });

  test("connecting is offered in step 1, after the wallet it connects exists, and nowhere above it", () => {
    vi.stubGlobal("fetch", serving({}));
    show(page(null));
    const connect = screen.getByRole("link", { name: "Connect it" });
    expect(connect.closest("li")).toHaveTextContent(/open the wallet, and add test USDC/i);
    // The header keeps its own Connect wallet; the steps have only this one.
    expect(screen.getAllByRole("link", { name: /^connect (it|wallet)$/i }).filter((a) => a.closest(".load-panel") !== null)).toEqual([connect]);
  });
});

/**
 * The main button on mainnet's first screen promised five minutes and opened a form only a developer
 * with a paying agent could fill in. Start there now sends a newcomer to where the setup runs.
 */
describe("Start on mainnet, beside a testnet gym", () => {
  const TESTNET_GYM = "https://testnet.bench.example";
  const here = on(MAINNET, { other: TESTNET_GYM });

  test("the way in is the setup on testnet, and the page says this is real money", () => {
    vi.stubGlobal("fetch", serving({}));
    show(page(null), here);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Set up on testnet.");
    expect(screen.getByRole("link", { name: "Set up on testnet" })).toHaveAttribute("href", `${TESTNET_GYM}/fund`);
    expect(screen.getByText(/you are on arc mainnet, where agents pay real USDC/i)).toBeInTheDocument();
    expect(screen.queryByText(/five minutes: two steps on your phone/i)).not.toBeInTheDocument();
  });

  test("an agent that pays for itself is told how, in full, and in real money's words", () => {
    vi.stubGlobal("fetch", serving({}));
    show(page(null), here);
    expect(screen.getByText("For developers.")).toBeInTheDocument();
    expect(screen.getByText(/you add USDC from a wallet in this browser, such as MetaMask, on Arc mainnet/i)).toBeInTheDocument();
    expect(screen.queryByText(/test USDC/i)).not.toBeInTheDocument();
  });
});

/** Every test above runs with no wallet connected, so the ticks themselves were never drawn in one. */
describe("with a wallet connected, the steps say where its owner is", () => {
  const W = "0x9fa928ACfE2eEcEad9698ebBad835E7129688b28";
  const connected = (owner: OwnerWire | 500) => {
    // This test environment has no working localStorage; a browser's is a map of strings like this one.
    const kept = new Map([["bench.owner.wallet", W]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/owner/${W}`) return owner === 500 ? new Response("{}", { status: 500 }) : new Response(JSON.stringify(owner), { status: 200 });
      if (url === `/funds/${W}`) return new Response(JSON.stringify(funds({ agent: W, wallet: "18.000000" })), { status: 200 });
      return new Response("{}", { status: 404 });
    }));
    show(page(null));
  };
  const granted: OwnerWire = { wallet: W, more: 0, partial: false, agents: [{
    address: AGENT, current: true, identity: "894767", rep: 14, repUnread: false, ranked: [], live: null, runs: [],
    spend: "0.000000", qualifies: [], won: [],
    // Used up: the owner whose agent spent its whole limit was shown steps 2 and 3 as still to do.
    allowance: { limit: "5.000000", used: "5.000000", remaining: "0.000000", validUntil: 0, live: false },
  }] };
  const steps = () => [1, 2, 3, 4, 5].map((n) => screen.queryByLabelText(`Step ${n}, done`) !== null);

  test("a wallet that granted an allowance, since used up, has done steps 1 to 3", async () => {
    connected(granted);
    await waitFor(() => expect(steps()).toEqual([true, true, true, false, false]));
    expect(screen.queryByText(/these steps tick themselves off/i)).not.toBeInTheDocument();
    // The step to do now is the one that stands out, and it leads to the owner's own page.
    expect(document.querySelector(".journey li.next")).toHaveClass("key");
    expect(screen.getByRole("link", { name: "Watch on My agent" })).toHaveAttribute("href", `/#yours/${W}`);
  });

  /** Not yet known was drawn as nothing done, with step 1 marked as the one to do next. */
  test("while its page cannot be read, the steps are shown plain: none ticked, and no prompt to connect", async () => {
    connected(500);
    // The tab knows the wallet at once; the steps wait on a page that does not come.
    const tabs = screen.getByRole("navigation", { name: "Pages" });
    await waitFor(() => expect(within(tabs).getByRole("link", { name: "My agent" })).toHaveAttribute("href", `/#yours/${W}`));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/owner/${W}`, expect.anything()));
    expect(steps()).toEqual([false, false, false, false, false]);
    expect(document.querySelector(".journey li.next")).toBeNull();
    expect(screen.queryByText(/these steps tick themselves off/i)).not.toBeInTheDocument();
  });
});
