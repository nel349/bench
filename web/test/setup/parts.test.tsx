import { openHints } from "../hints.ts";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../strings.tsx";
import { MAINNET, NETWORKS, TESTNET, on } from "../network.ts";
import { AmountChoice } from "../../src/setup/AmountChoice.tsx";
import { Balance } from "../../src/setup/Balance.tsx";
import { FundingProgress } from "../../src/setup/FundingProgress.tsx";
import { Unguided } from "../../src/setup/Unguided.tsx";
import { ConnectorFor } from "../../src/setup/ConnectorFor.tsx";
import { Journey } from "../../src/setup/Journey.tsx";
import { OwnKeySteps } from "../../src/setup/OwnKeySteps.tsx";
import { CONNECTOR_INSTALL, CURSOR_CONFIG, CODEX_CONFIG, OWN_KEY_EXAMPLE, SKILL_INSTALL } from "../../src/setup/steps.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "../../src/shared/chain/config.ts";
import type { Network } from "../../src/shared/network/network.ts";

const TX = "0x3c9f1e2a4b5d6c7e8f901a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7";
const WALLET = "https://kuiralabs.github.io/mandate/";
const GYM = "https://bench.example";
const OWNER = "0x9fa928ACfE2eEcEad9698ebBad835E7129688b28";

beforeEach(() => { vi.restoreAllMocks(); });

describe("how much to add", () => {
  test("offers each amount as a button, in dollars, and says which was chosen", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<AmountChoice amounts={["1", "5", "25"]} disabled={false} onChoose={onChoose} />);
    const group = screen.getByRole("group", { name: "How much to add" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["$1", "$5", "$25"]);
    await user.click(within(group).getByRole("button", { name: "$5" }));
    expect(onChoose).toHaveBeenCalledExactlyOnceWith("5");
  });

  test("while money is moving, none of them can be pressed", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<AmountChoice amounts={["1", "5"]} disabled onChoose={onChoose} />);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "$1" }));
    expect(onChoose).not.toHaveBeenCalled();
  });
});

describe("one balance", () => {
  test("says what it is, how much, in dollars, and what it is for", () => {
    render(<dl><Balance label="Its balance" amount="0.500000" tone="ready">What it pays questions from.</Balance></dl>);
    expect(screen.getByText("Its balance")).toBeInTheDocument();
    const amount = screen.getByText("$0.50");
    expect(amount).toHaveClass("ready");
    expect(screen.getByText("What it pays questions from.")).toBeInTheDocument();
  });

  test("its tone is the state it is in", () => {
    render(<dl>
      <Balance label="a" amount="0.000000" tone="short">x</Balance>
      <Balance label="b" amount="5.000000" tone="idle">y</Balance>
    </dl>);
    expect(screen.getByText("$0.00")).toHaveClass("short");
    expect(screen.getByText("$5.00")).toHaveClass("idle");
  });
});

describe("what is happening while money is added", () => {
  test("says nothing before anything has started", () => {
    const { container } = render(<FundingProgress state={{ step: "idle" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  test.each([
    [{ step: "connecting" } as const, "Asking your wallet…"],
    [{ step: "allowing" } as const, "Step 1 of 2. Approve the transfer in your wallet."],
    [{ step: "sending" } as const, "Step 2 of 2. Send it to your agent from your wallet."],
    [{ step: "settling", tx: TX } as const, "Sent. Waiting for the network…"],
    [{ step: "declined" } as const, "You cancelled it. Nothing was sent."],
  ])("each step on the way is said in the owner's terms: %o", (state, words) => {
    render(<FundingProgress state={state} />);
    expect(screen.getByText(words)).toBeInTheDocument();
  });

  test.each(NETWORKS)("once sent on %s, it links the transfer on that network's explorer", (_name, network) => {
    render(<FundingProgress state={{ step: "sent", tx: TX }} />, { network });
    expect(screen.getByRole("link", { name: "See it on the explorer" })).toHaveAttribute("href", `${network.explorer}/tx/${TX}`);
  });

  test("a failure says nothing was lost, and why, in words", () => {
    render(<FundingProgress state={{ step: "failed", because: { id: "funding.noWallet" } }} />);
    const said = screen.getByText(/that did not go through/i);
    expect(said).toHaveClass("bad");
    expect(said).toHaveTextContent("Nothing was lost. No wallet was found in this browser.");
  });
});

describe("Start where the guided setup does not run", () => {
  test("beside a testnet gym, it says to set up there, and goes there", () => {
    render(<Unguided />, { network: on(MAINNET, { other: "https://testnet.bench.example" }) });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Set up on testnet.");
    expect(screen.getByRole("link", { name: "Set up on testnet" })).toHaveAttribute("href", "https://testnet.bench.example/fund");
    expect(screen.getByText(/you are on arc mainnet, where agents pay real USDC/i)).toBeInTheDocument();
  });

  test("with nowhere else to go, it says the setup is not here yet and offers no way out", () => {
    render(<Unguided />, { network: MAINNET });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The guided setup is not here yet.");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/an agent can play here if it pays for itself/i)).toBeInTheDocument();
  });

  test("on testnet with no wallet, it names testnet and promises no real USDC", () => {
    render(<Unguided />, { network: on(TESTNET, { walletUrl: null }) });
    expect(screen.getByText(/you are on arc testnet\. allowances are not here yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/real USDC/)).not.toBeInTheDocument();
  });
});

describe("the connector, for the agent the owner runs", () => {
  test("on testnet each line is the connector's default, with no network named", async () => {
    const user = userEvent.setup();
    render(<ConnectorFor />, { network: TESTNET });
    const pick = screen.getByRole("group", { name: "Your agent" });
    expect(screen.getByText(CONNECTOR_INSTALL)).toBeInTheDocument();
    await user.click(within(pick).getByRole("button", { name: "Cursor" }));
    expect(within(pick).getByRole("button", { name: "Cursor" })).toHaveAttribute("aria-pressed", "true");
    expect(within(pick).getByRole("button", { name: "Claude Code" })).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector(".copy-line code")?.textContent).toBe(CURSOR_CONFIG);
    await user.click(within(pick).getByRole("button", { name: "Codex" }));
    expect(document.querySelector(".copy-line code")?.textContent).toBe(CODEX_CONFIG);
    expect(screen.queryByText(/ARC_MANDATE_NETWORK/)).not.toBeInTheDocument();
  });

  test("on mainnet every line names the network, so the connector does not fall back to testnet", async () => {
    const user = userEvent.setup();
    render(<ConnectorFor />, { network: MAINNET });
    const pick = screen.getByRole("group", { name: "Your agent" });
    const line = () => document.querySelector(".copy-line code")?.textContent ?? "";
    expect(line()).toMatch(/@kuiralabs\/arc-mandate mainnet$/);
    await user.click(within(pick).getByRole("button", { name: "Cursor" }));
    expect(JSON.parse(line())).toMatchObject({ mcpServers: { "arc-mandate-mainnet": { args: ["-y", "@kuiralabs/arc-mandate", "mainnet"] } } });
    await user.click(within(pick).getByRole("button", { name: "Codex" }));
    expect(line()).toMatch(/args = \["-y", "@kuiralabs\/arc-mandate", "mainnet"\]/);
  });

  test("the copy button copies the line shown, whole", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ConnectorFor />, { network: TESTNET });
    await user.click(screen.getByRole("button", { name: "Copy the connector's install line" }));
    expect(writeText).toHaveBeenCalledWith(CONNECTOR_INSTALL);
  });
});

describe("the five steps", () => {
  const journey = (over: Partial<React.ComponentProps<typeof Journey>> = {}) => (
    <Journey wallet={WALLET} gym={GYM} progress={null} connectHref="/connect" onConnect={() => {}} owner={null} {...over} />
  );
  const marks = () => [...document.querySelectorAll(".journey li")].map((li) => li.className);

  test("with no wallet connected, nothing is ticked, nothing is next, and connecting is offered in step 1", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    render(journey({ onConnect }));
    expect(marks()).toEqual(["", "", "", "key", ""]);
    for (const n of [1, 2, 3, 4, 5]) expect(screen.getByLabelText(`Step ${n}`)).toHaveTextContent(String(n));
    const connect = screen.getByRole("link", { name: "Connect it" });
    expect(connect).toHaveAttribute("href", "/connect");
    connect.addEventListener("click", (e) => e.preventDefault());
    await user.click(connect);
    expect(onConnect).toHaveBeenCalledOnce();
  });

  test("where Connect wallet goes nowhere, it is not offered", () => {
    render(journey({ connectHref: null }));
    expect(screen.queryByRole("link", { name: "Connect it" })).not.toBeInTheDocument();
  });

  test("with a wallet connected, the steps done are ticked, the first not done is next, and connecting is not offered again", () => {
    render(journey({ progress: [true, true, false, false, false], owner: OWNER }));
    expect(marks()).toEqual(["done", "done", "next", "key", ""]);
    expect(screen.getByLabelText("Step 1, done")).toHaveTextContent("✓");
    expect(screen.getByLabelText("Step 3")).toHaveTextContent("3");
    expect(screen.queryByRole("link", { name: "Connect it" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Watch on My agent" })).toHaveAttribute("href", `/#yours/${OWNER}`);
  });

  test("with every step done, none is next", () => {
    render(journey({ progress: [true, true, true, true, true], owner: OWNER }));
    expect(document.querySelector(".journey li.next")).toBeNull();
    expect(screen.getAllByLabelText(/^Step \d, done$/)).toHaveLength(5);
  });

  test("step 1 gives a laptop a code that opens the wallet, and a phone the button", async () => {
    render(journey());
    const code = await screen.findByRole("img", { name: "A code that opens the wallet on your phone" });
    expect(code.getAttribute("src")).toMatch(/^data:image\/svg\+xml;utf8,/);
    expect(code.closest(".laptop-only")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Open the wallet" })).toHaveAttribute("href", WALLET);
  });

  test("the laptop's steps give a phone this page's address to open on the laptop", () => {
    render(journey());
    const notes = [...document.querySelectorAll(".phone-note code")].map((c) => c.textContent);
    expect(notes).toEqual([`${GYM}/fund`, `${GYM}/fund`]);
  });

  test("on testnet step 1 is test USDC from the faucet button; on mainnet it is real USDC, sent", () => {
    const { unmount } = render(journey(), { network: TESTNET });
    expect(screen.getByRole("heading", { level: 3, name: /open the wallet, and add test USDC/i })).toBeInTheDocument();
    openHints();
    expect(screen.getByText(/a button for test USDC, which is free/i)).toBeInTheDocument();
    unmount();
    render(journey(), { network: on(MAINNET, { walletUrl: WALLET }) });
    expect(screen.getByRole("heading", { level: 3, name: /open the wallet, and add USDC/i })).not.toHaveTextContent(/test/i);
    openHints();
    expect(screen.getByText(/this is real USDC: once your wallet is made, send USDC on Arc mainnet/i)).toBeInTheDocument();
  });
  test("a step shows what to do, and its explanation opens and closes with the question mark", () => {
    render(journey());
    const step = document.querySelectorAll(".journey li")[1]!;
    const hint = within(step as HTMLElement).getByRole("button", { name: "About step 2" });
    expect(hint).toHaveAttribute("aria-expanded", "false");
    expect(step).not.toHaveTextContent(/teaches your agent the gym/);
    act(() => { fireEvent.click(hint); });
    expect(hint).toHaveAttribute("aria-expanded", "true");
    expect(step).toHaveTextContent(/teaches your agent the gym/);
    act(() => { fireEvent.click(hint); });
    expect(step).not.toHaveTextContent(/teaches your agent the gym/);
  });
});

describe("an agent that pays for itself, from nothing", () => {
  /** Nothing is looked up until an address is checked, so no request is answered. */
  const nothing = vi.fn(async () => new Response("{}", { status: 404 }));
  const show = (network: Network) => {
    vi.stubGlobal("fetch", nothing);
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <WagmiProvider config={wagmiConfig}><QueryClientProvider client={queries}>
        <OwnKeySteps gym={GYM} initialAgent={null} />
      </QueryClientProvider></WagmiProvider>,
      { network },
    );
  };

  test("three steps: what it needs, adding to its balance, and sending it here, the last the one that stands out", () => {
    show(TESTNET);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "What your agent needs", "Add to its balance", "Send it to train",
    ]);
    expect([...document.querySelectorAll(".journey li")].map((li) => li.className)).toEqual(["", "", "key"]);
    expect(screen.getByRole("link", { name: "scripts/real-run.ts" })).toHaveAttribute("href", OWN_KEY_EXAMPLE);
    const lines = [...document.querySelectorAll(".copy-line code")].map((c) => c.textContent);
    expect(lines).toEqual([SKILL_INSTALL, `Train on Bench at ${GYM}: solve and record as many exercises as you can, and spend as little as you can.`]);
    expect(nothing).not.toHaveBeenCalled();
  });

  test("on testnet the money is test USDC, on Arc testnet", () => {
    show(TESTNET);
    expect(screen.getByText(/with a key of its own and test USDC/i)).toBeInTheDocument();
    expect(screen.getByText(/you add test USDC from a wallet in this browser, such as MetaMask, on Arc testnet/i)).toBeInTheDocument();
  });

  test("on mainnet the money is real USDC, on Arc mainnet, and nothing calls it test money", () => {
    show(MAINNET);
    expect(screen.getByText(/with a key of its own and real USDC/i)).toBeInTheDocument();
    expect(screen.getByText(/you add USDC from a wallet in this browser, such as MetaMask, on Arc mainnet/i)).toBeInTheDocument();
    expect(screen.queryByText(/test USDC/i)).not.toBeInTheDocument();
  });
});

