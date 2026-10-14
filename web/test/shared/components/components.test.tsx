import { describe, expect, test, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../strings.tsx";
import { Amount } from "../../../src/shared/components/Amount.tsx";
import { CopyLine } from "../../../src/shared/components/CopyLine.tsx";
import { QrCode } from "../../../src/shared/components/QrCode.tsx";

beforeEach(() => { vi.restoreAllMocks(); });

describe("an amount", () => {
  test("is set as dollars, then cents, apart, so the cents can be dimmed", () => {
    const { container } = render(<Amount value="12.340000" />);
    const amount = container.querySelector(".amount")!;
    expect(amount).toHaveTextContent("$12.34");
    expect(amount).not.toHaveClass("amount-display");
    expect(amount.querySelector(".currency")).toHaveTextContent("$");
    expect(amount.querySelector(".cents")).toHaveTextContent(".34");
  });

  test("a whole number still shows its cents", () => {
    const { container } = render(<Amount value="5.000000" />);
    expect(container.querySelector(".cents")).toHaveTextContent(".00");
    expect(container).toHaveTextContent("$5.00");
  });

  test("a hero figure is marked as one", () => {
    const { container } = render(<Amount value="0.250000" display />);
    expect(container.querySelector(".amount")).toHaveClass("amount-display");
  });
});

describe("a line to copy", () => {
  test("shows the line whole, and its button says what it copies", () => {
    render(<CopyLine text="npx skills add nel349/bench" label="copy.skill" />);
    expect(screen.getByText("npx skills add nel349/bench")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy the skill's install line" })).toHaveTextContent("Copy");
  });

  test("copies exactly the line, and says it did", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CopyLine text="a line" label="copy.sentence" />);
    await user.click(screen.getByRole("button", { name: "Copy the sentence for your agent" }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith("a line");
    expect(await screen.findByRole("button", { name: "Copy the sentence for your agent" })).toHaveTextContent("Copied");
  });
});

describe("a code to scan", () => {
  const svgOf = (img: HTMLElement) => decodeURIComponent(img.getAttribute("src")!.replace(/^data:image\/svg\+xml;utf8,/, ""));

  test("is drawn in the page as an image, named for what it opens", async () => {
    render(<QrCode text="https://kuiralabs.github.io/mandate/" label="Opens the wallet" />);
    const img = await screen.findByRole("img", { name: "Opens the wallet" });
    expect(img).toHaveClass("qr");
    expect(svgOf(img)).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
    // Dark on light, which a camera reads best.
    expect(svgOf(img)).toContain("#05030c");
    expect(svgOf(img)).toContain("#f4f2ff");
  });

  test("another address is another code", async () => {
    const { rerender } = render(<QrCode text="https://a.example/" label="code" />);
    const first = svgOf(await screen.findByRole("img", { name: "code" }));
    rerender(<QrCode text="https://b.example/" label="code" />);
    await waitFor(() => expect(svgOf(screen.getByRole("img", { name: "code" }))).not.toBe(first));
  });
});
