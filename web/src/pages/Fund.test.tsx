import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import type { Address } from "viem";
import { wagmiConfig } from "../chain/config.ts";
import { Fund } from "./Fund.tsx";
import type { FundsWire } from "../../../src/wire.ts";

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

function show(node: React.ReactNode) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queries}>{node}</QueryClientProvider>
    </WagmiProvider>,
  );
}

const WALLET = "https://kuiralabs.github.io/mandate/";
const GYM = "https://bench.example";

const page = (initialAgent: string | null, wallet: string | null = WALLET) => (
  <Fund chainId={5042002} usdc={"0x3600000000000000000000000000000000000000" as Address}
        gateway={"0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as Address}
        probePrice="0.020000" wallet={wallet} gym={GYM} initialAgent={initialAgent} />
);

/** The deposit is the second way; a page opened without an agent in its link starts on the first. */
const toOwnKey = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /from its own key/i }));

beforeEach(() => { vi.restoreAllMocks(); });

describe("the front door", () => {
  test("asks for an address before anything else", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", serving({}));
    show(page(null));
    await toOwnKey(user);
    expect(screen.getByText(/paste an address to see what it holds/i)).toBeInTheDocument();
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
    expect(screen.getByText(/cannot pay for anything\. It has to be moved across/i)).toBeInTheDocument();
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

    await user.type(screen.getByLabelText(/the address your agent printed/i), "9");
    await waitFor(() => {
      expect(screen.queryByText(/can ask 25 questions/i)).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("group", { name: /how much to give/i })).not.toBeInTheDocument();
  });

  test("Check is refused until the address is one", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", serving({ [OTHER]: funds({ agent: OTHER }) }));
    show(page(null));
    await toOwnKey(user);
    const check = screen.getByRole("button", { name: /check/i });
    expect(check).toBeDisabled();
    await user.type(screen.getByLabelText(/the address your agent printed/i), OTHER);
    expect(check).toBeEnabled();
  });
});

describe("with an allowance, the way offered first", () => {
  test("the five steps, in order, in the words the wallet and the connector use", () => {
    vi.stubGlobal("fetch", serving({}));
    show(page(null));
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual([
      "Get the app, and add test USDC phone",
      "Connect your agent laptop",
      "Scan to grant phone",
      "Tell your agent to play laptop",
      "Watch it spend, revoke any time phone",
    ]);
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

    const sentence = `Train on Bench at ${GYM}: rank as many problems as you can, and spend as little as you can.`;
    expect(screen.getByText(sentence)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /copy the sentence for your agent/i }));
    expect(writeText).toHaveBeenCalledWith(sentence);
    expect(await screen.findByRole("button", { name: /copy the sentence/i })).toHaveTextContent("Copied");
  });

  test("no deposit is offered, and nothing says it cannot be undone", () => {
    vi.stubGlobal("fetch", serving({}));
    show(page(null));
    expect(screen.queryByLabelText(/the address your agent printed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/cannot be undone/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/an allowance/i);
  });

  /** A link carrying an agent names a key, and the key is what a deposit is for. */
  test("a link naming an agent opens on its own key", async () => {
    vi.stubGlobal("fetch", serving({ [AGENT]: funds() }));
    show(page(AGENT));
    expect(screen.getByRole("button", { name: /from its own key/i })).toHaveAttribute("aria-pressed", "true");
    // The headline follows the way chosen, rather than promising an allowance beside a deposit.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/something to spend/i);
    expect(await screen.findByText(/can ask 25 questions/i)).toBeInTheDocument();
  });

  /** Mainnet has no wallet yet. A testnet link there would open a wallet on the wrong network. */
  test("where no wallet serves the network, only the agent's own key is offered, and the page says why", () => {
    vi.stubGlobal("fetch", serving({}));
    show(page(null, null));
    expect(screen.queryByRole("button", { name: /with an allowance/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open the wallet/i })).not.toBeInTheDocument();
    expect(screen.getByText(/no wallet serves this network yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/the address your agent printed/i)).toBeInTheDocument();
  });
});
