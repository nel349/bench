import { afterEach, describe, expect, test, vi } from "vitest";
import { writeClipboard } from "./clipboard.ts";

/** jsdom has no execCommand of its own; the browser's is stood in for, to see what it was asked. */
const execCommand = (result: boolean) => {
  const copied: string[] = [];
  const fn = vi.fn((command: string) => {
    const field = document.activeElement as HTMLTextAreaElement | null;
    if (command === "copy" && field?.tagName === "TEXTAREA") copied.push(field.value);
    return result;
  });
  Object.defineProperty(document, "execCommand", { value: fn, configurable: true });
  return copied;
};

const clipboard = (value: unknown) =>
  Object.defineProperty(navigator, "clipboard", { value, configurable: true });

afterEach(() => { clipboard(undefined); });

describe("copying", () => {
  test("uses the Clipboard API where the page has it", async () => {
    const writeText = vi.fn(async () => {});
    clipboard({ writeText });
    expect(await writeClipboard("the line")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("the line");
  });

  /** The testnet gym is plain http, where the API is missing and every Copy did nothing. */
  test("copies a selection on a page with no Clipboard API, and leaves nothing behind", async () => {
    clipboard(undefined);
    const copied = execCommand(true);
    expect(await writeClipboard("Train on Bench at http://gym:8975")).toBe(true);
    expect(copied).toEqual(["Train on Bench at http://gym:8975"]);
    expect(document.querySelector("textarea")).toBeNull();
  });

  test("falls back when the Clipboard API refuses", async () => {
    clipboard({ writeText: vi.fn(async () => { throw new Error("denied"); }) });
    const copied = execCommand(true);
    expect(await writeClipboard("x")).toBe(true);
    expect(copied).toEqual(["x"]);
  });

  test("says so when the browser refuses both ways", async () => {
    clipboard(undefined);
    execCommand(false);
    expect(await writeClipboard("x")).toBe(false);
  });
});
