import { expect, test, describe } from "bun:test";
import { html, esc, trusted, Safe } from "./html.ts";

describe("escaping", () => {
  test("a hole is escaped", () => {
    expect(html`<p>${"<script>alert(1)</script>"}</p>`.value)
      .toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  test("an agent name cannot break out of an attribute", () => {
    const evil = `" onmouseover="steal()`;
    expect(html`<b title="${evil}">x</b>`.value).not.toContain('onmouseover="steal()"');
  });

  test("ampersands are escaped first, so nothing is double-decoded", () => {
    expect(esc("&lt;")).toBe("&amp;lt;");
  });

  test("a fragment nests without being escaped twice", () => {
    const row = html`<td>${"a & b"}</td>`;
    expect(html`<tr>${row}</tr>`.value).toBe("<tr><td>a &amp; b</td></tr>");
  });

  test("an array of fragments becomes a list, not a comma-joined string", () => {
    const rows = [html`<li>${1}</li>`, html`<li>${2}</li>`];
    expect(html`<ul>${rows}</ul>`.value).toBe("<ul><li>1</li><li>2</li></ul>");
  });

  test("a plain array of strings is still escaped element by element", () => {
    expect(html`<p>${["<b>", "<i>"]}</p>`.value).toBe("<p>&lt;b&gt;&lt;i&gt;</p>");
  });

  test("trusted markup passes through, which is the whole point of naming it", () => {
    expect(html`<div>${trusted("<hr>")}</div>`.value).toBe("<div><hr></div>");
  });

  test("html returns Safe, so a page composes from fragments", () => {
    expect(html`<p>x</p>`).toBeInstanceOf(Safe);
  });

  test("null and numbers survive without becoming the string 'undefined'", () => {
    expect(html`<p>${null}${0}</p>`.value).toBe("<p>null0</p>");
  });
});
