import { beforeEach, describe, expect, test, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { render } from "./strings.tsx";
import { MAINNET, NETWORKS, TESTNET, on } from "./network.ts";
import type { Network } from "../src/shared/network/network.ts";
import { networkOf } from "../src/shared/network/network.ts";
import { useNetwork } from "../src/shared/network/NetworkProvider.tsx";
import { wagmiConfig } from "../src/shared/chain/config.ts";
import { Home } from "../src/shell/Home.tsx";
import { SetUp } from "../src/setup/SetUp.tsx";
import { NetworkSwitch } from "../src/shell/NetworkSwitch.tsx";
import { render as renderBare } from "@testing-library/react";

const TESTNET_GYM = "https://testnet.bench.example";
const MAINNET_GYM = "https://bench.example";

/** A gym with nothing in it yet, which is what a page must still draw on. */
const empty = vi.fn(async (input: RequestInfo | URL) => {
  const body: Record<string, unknown> = { "/problems": [], "/bounties": [], "/feed": [], "/standings": { agents: [], best: [], more: 0 } };
  const found = body[String(input)];
  return found === undefined ? new Response("{}", { status: 404 }) : new Response(JSON.stringify(found), { status: 200 });
});

function show(node: React.ReactNode, network: Network) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <WagmiProvider config={wagmiConfig}><QueryClientProvider client={queries}>{node}</QueryClientProvider></WagmiProvider>,
    { network },
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", empty);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {},
  }));
  window.location.hash = "";
});

describe("the network a gym describes", () => {
  test("is built from its settings, with the chain's own explorer", () => {
    expect(TESTNET.testnet).toBe(true);
    expect(TESTNET.explorer).toBe("https://testnet.arcscan.app");
    expect(MAINNET.testnet).toBe(false);
    expect(MAINNET.explorer).toBe("https://arcscan.app");
    expect(MAINNET.gateway).not.toBe(TESTNET.gateway);
  });

  test("a chain the page cannot use is no network", () => {
    expect(networkOf({ chainId: 1, usdc: TESTNET.usdc, gateway: TESTNET.gateway, probePrice: "0.020000", reputation: null, wallet: null, other: null })).toBeNull();
  });

  // The page and the gym are deployed separately, and a gym a version behind does not send `other`.
  test("a gym that does not say whether it has a counterpart has none", () => {
    const older = { chainId: 5042, usdc: MAINNET.usdc, gateway: MAINNET.gateway, probePrice: "0.020000", reputation: null, wallet: null };
    expect(networkOf(older as never)?.other).toBeNull();
  });

  // A default would be a network picked by the page, which is how money goes to the wrong one.
  test("a component outside a network is an error, and not a guess", () => {
    const Asks = () => <>{useNetwork().explorer}</>;
    const silenced = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderBare(<Asks />)).toThrow("outside a NetworkProvider");
    silenced.mockRestore();
  });
});

/**
 * Every page, drawn on each network with strict words: a message that is missing, or one written
 * for the other network, throws. Mainnet's pages were never drawn in a test before, which is how
 * four of them came to say things that were only true on testnet.
 */
describe.each(NETWORKS)("every page draws on %s", (name, network) => {
  const paired = on(network, { other: name === "testnet" ? MAINNET_GYM : TESTNET_GYM });

  test.each(["", "#yours", "#exercises", "#standings", "#gigs"])("the view %s", async (hash) => {
    window.location.hash = hash;
    show(<Home probePrice="0.020000" />, paired);
    expect(await screen.findByRole("navigation", { name: "Pages" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Network" })).toHaveTextContent(name === "testnet" ? "Testnet · test money" : "Mainnet · real USDC");
  });

  test("Start", () => {
    show(<SetUp probePrice="0.020000" gym={name === "testnet" ? TESTNET_GYM : MAINNET_GYM} initialAgent={null} />, paired);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Network" })).toBeInTheDocument();
  });
});

describe("the network, and the way to the other one", () => {
  test("mainnet says its money is real, and offers testnet at the same view", () => {
    window.location.hash = "#standings/2419";
    show(<NetworkSwitch />, on(MAINNET, { other: TESTNET_GYM }));
    const group = screen.getByRole("group", { name: "Network" });
    expect(within(group).getByText("Mainnet · real USDC")).toHaveAttribute("aria-current", "true");
    expect(within(group).getByRole("link", { name: "Testnet" })).toHaveAttribute("href", `${TESTNET_GYM}/#standings`);
  });

  test("testnet says its money is test money, and offers mainnet", () => {
    show(<NetworkSwitch />, on(TESTNET, { other: MAINNET_GYM }));
    const group = screen.getByRole("group", { name: "Network" });
    expect(within(group).getByText("Testnet · test money")).toHaveAttribute("aria-current", "true");
    expect(within(group).getByRole("link", { name: "Mainnet" })).toHaveAttribute("href", `${MAINNET_GYM}/`);
  });

  // The network and its money are still said: a phone draws no frame edge to say it.
  test("a gym with no counterpart names itself and offers nowhere to go", () => {
    show(<NetworkSwitch />, MAINNET);
    const group = screen.getByRole("group", { name: "Network" });
    expect(group).toHaveTextContent("Mainnet · real USDC");
    expect(within(group).queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("the first screen on mainnet, beside a testnet gym", () => {
  const here = on(MAINNET, { other: TESTNET_GYM });

  /** It promised "about five minutes" and opened a form only a developer with a paying agent could fill in. */
  test("the main button goes to the setup on testnet, and the page says this one is real money", async () => {
    show(<Home probePrice="0.020000" />, here);
    expect(await screen.findByRole("link", { name: "Try it on testnet" })).toHaveAttribute("href", `${TESTNET_GYM}/fund`);
    expect(screen.queryByRole("link", { name: "Set up your agent" })).not.toBeInTheDocument();
    expect(screen.getByText(/you are on arc mainnet, where agents pay real USDC/i)).toBeInTheDocument();
  });

  test("the steps are testnet's and say so, and what can be done here is one line under them", async () => {
    show(<Home probePrice="0.020000" />, here);
    const how = await screen.findByRole("region", { name: "How it goes, on testnet today" });
    expect(within(how).getAllByRole("heading", { level: 3 })[0]).toHaveTextContent("You give it an allowance");
    expect(within(how).getByRole("link", { name: "How that works" })).toHaveAttribute("href", "/fund");
  });
});
