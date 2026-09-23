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

const page = (initialAgent: string | null) => (
  <Fund chainId={5042002} usdc={"0x3600000000000000000000000000000000000000" as Address}
        gateway={"0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as Address}
        probePrice="0.020000" initialAgent={initialAgent} />
);

beforeEach(() => { vi.restoreAllMocks(); });

describe("the front door", () => {
  test("asks for an address before anything else", () => {
    vi.stubGlobal("fetch", serving({}));
    show(page(null));
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
    const check = screen.getByRole("button", { name: /check/i });
    expect(check).toBeDisabled();
    await user.type(screen.getByLabelText(/the address your agent printed/i), OTHER);
    expect(check).toBeEnabled();
  });
});
