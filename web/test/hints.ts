import { act, fireEvent } from "@testing-library/react";

/**
 * Opens every "?" on the page, or under one element, as a person tapping each would. What a step or a
 * page explains sits behind its "?" now, so a test that reads an explanation opens it first.
 */
export function openHints(under: ParentNode = document): void {
  act(() => {
    for (const hint of [...under.querySelectorAll<HTMLButtonElement>("button.hint[aria-expanded='false']")]) fireEvent.click(hint);
  });
}
