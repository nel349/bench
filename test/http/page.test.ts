import { describe, expect, test } from "bun:test";
import { isPagePath, wantsHtml } from "../../src/http/page.ts";
import { PATHS } from "../../src/shared/paths.ts";

describe("who is given the page", () => {
  test("a browser says it wants HTML, and a plain client does not", () => {
    expect(wantsHtml(new Request("http://bench.test/", { headers: { accept: "text/html,application/xhtml+xml" } }))).toBe(true);
    expect(wantsHtml(new Request("http://bench.test/"))).toBe(false);
  });

  // Start's link is printed on the site and given to agents; a client fetching it was told "no route".
  test("Start is a page whoever asks for it", () => {
    expect(isPagePath(PATHS.fund)).toBe(true);
  });

  // A typo in an API path must still get the 404 it asked for, and not a page of HTML to choke on.
  test("an API path, a mistyped one, and the index are not", () => {
    expect(isPagePath(PATHS.problems)).toBe(false);
    expect(isPagePath("/problemz")).toBe(false);
    expect(isPagePath(PATHS.index)).toBe(false);
  });
});
