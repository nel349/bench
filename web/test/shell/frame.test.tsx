import { describe, expect, test, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { render } from "../strings.tsx";
import { MAINNET, TESTNET, on } from "../network.ts";
import { Masthead } from "../../src/shell/Masthead.tsx";
import { Plate } from "../../src/shell/Plate.tsx";
import { FirstScreen, type FirstScreenProps } from "../../src/shell/FirstScreen.tsx";

const WALLET = "https://kuiralabs.github.io/mandate/";
const TESTNET_GYM = "https://testnet.bench.example";

beforeEach(() => {
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("the masthead", () => {
  test("the name leads home, and beside it is which network this is", () => {
    render(<Masthead home="/#home" />, { network: on(MAINNET, { other: TESTNET_GYM }) });
    expect(screen.getByRole("link", { name: "BENCH//" })).toHaveAttribute("href", "/#home");
    const network = screen.getByRole("group", { name: "Network" });
    expect(network).toHaveTextContent("Mainnet · real USDC");
    expect(within(network).getByRole("link", { name: "Testnet" })).toBeInTheDocument();
  });

  test("on testnet it says test money", () => {
    render(<Masthead home="/" />, { network: TESTNET });
    expect(screen.getByRole("group", { name: "Network" })).toHaveTextContent("Testnet · test money");
  });
});

describe("the plate", () => {
  test("prints on each edge only what it is given, and the one exposure in the middle", () => {
    const { container } = render(
      <Plate top={{ start: "top left" }} bottom={{ end: "bottom right" }} right="down the side">
        <p>the picture</p>
      </Plate>,
    );
    expect([...container.querySelectorAll(".edge")].map((e) => [e.className, e.textContent])).toEqual([
      ["edge top start", "top left"], ["edge right", "down the side"], ["edge bottom end", "bottom right"],
    ]);
    expect(screen.getByRole("main")).toHaveTextContent("the picture");
    expect(container.querySelector(".caption")).toBeNull();
  });

  test("the caption is read out when it changes", () => {
    const { container } = render(<Plate caption="the line to read"><p>x</p></Plate>);
    expect(container.querySelector(".caption")).toHaveAttribute("aria-live", "polite");
    expect(container.querySelector(".caption")).toHaveTextContent("the line to read");
  });

  test("the grain and the frame line are not read out", () => {
    const { container } = render(<Plate><p>x</p></Plate>);
    expect(container.querySelector(".grain")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".frame")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("the first screen, drawn on its own", () => {
  const quiet: FirstScreenProps = { leader: null, cheapest: null, agents: 0, runs: 0, gigs: null, prices: null };
  const steps = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);

  test("on testnet with the wallet, the way in is Set up your agent, by allowance, in test money", () => {
    render(<FirstScreen {...quiet} />, { network: on(TESTNET, { walletUrl: WALLET }) });
    expect(screen.getByRole("link", { name: "Set up your agent" })).toHaveAttribute("href", "/fund");
    expect(steps()[0]).toBe("You give it an allowance");
    expect(screen.getByText(/Test money, on Arc testnet\./)).toBeInTheDocument();
  });

  /** Mainnet part 2: once the wallet serves mainnet, mainnet's first screen is the guided setup, in real money. */
  test("on mainnet once the wallet serves it, the way in is here, by allowance, and paid in USDC", () => {
    render(<FirstScreen {...quiet} />, { network: on(MAINNET, { walletUrl: WALLET, other: TESTNET_GYM }) });
    expect(screen.getByRole("link", { name: "Set up your agent" })).toHaveAttribute("href", "/fund");
    expect(screen.queryByRole("link", { name: "Try it on testnet" })).not.toBeInTheDocument();
    expect(steps()[0]).toBe("You give it an allowance");
    expect(screen.getByRole("region", { name: "How it goes" })).toBeInTheDocument();
    expect(screen.getByText(/Paid in USDC, on Arc\./)).toBeInTheDocument();
    expect(screen.queryByText(/test money/i)).not.toBeInTheDocument();
  });

  test("on mainnet with no wallet and no testnet gym, the first step is a balance, and the way in is still here", () => {
    render(<FirstScreen {...quiet} />, { network: MAINNET });
    expect(screen.getByRole("link", { name: "Set up your agent" })).toHaveAttribute("href", "/fund");
    expect(steps()[0]).toBe("You give it a balance");
    expect(screen.queryByText(/how, for developers/)).not.toBeInTheDocument();
  });

  test("with nothing to say yet, it says nothing: no prices, no facts", () => {
    const { container } = render(<FirstScreen {...quiet} />, { network: TESTNET });
    expect(container.querySelector(".facts")).toBeNull();
    expect(screen.queryByText(/what it costs/i)).not.toBeInTheDocument();
  });

  test("a cheapest record with nobody leading and no gig is not shown on its own", () => {
    const { container } = render(<FirstScreen {...quiet} cheapest={{ title: "Toll", spend: "0.020000" }} />, { network: TESTNET });
    expect(container.querySelector(".facts")).toBeNull();
  });
});
