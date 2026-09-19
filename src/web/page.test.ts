import { expect, test, describe, beforeEach } from "bun:test";
import { handle, type Deps } from "../http.ts";
import { Attempts } from "../attempt.ts";
import { InMemoryAllowance } from "../payments.ts";
import { usdc } from "../money.ts";
import { renderPage } from "./page.ts";
import type { WireBounty } from "../bounties.ts";
import { PATHS, FEED_LIMIT } from "./paths.ts";
import "../problems/blackbox-problem.ts";
import "../problems/zendo.ts";
import "../problems/toll.ts";

const AGENT = "agent:aria";
let money: InMemoryAllowance;
let deps: Deps;

beforeEach(() => {
  money = new InMemoryAllowance();
  money.grant(AGENT, usdc("5"));
  deps = { attempts: new Attempts(money), payments: money, net: "testnet" };
});

const get = (path: string, headers: Record<string, string> = {}) =>
  handle(new Request(`http://bench.test${path}`, { headers }), deps);

const asHtml = { accept: "text/html,application/xhtml+xml" };

describe("one URL, two audiences", () => {
  test("a browser gets the page", async () => {
    const r = await get(PATHS.index, asHtml);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(await r.text()).toContain("<!doctype html>");
  });

  test("anything else still gets the JSON index, so no client breaks", async () => {
    const r = await get(PATHS.index);
    expect(r.headers.get("content-type")).toContain("application/json");
    expect(await r.json()).toMatchObject({ service: "bench" });
  });

  test("an agent asking for JSON explicitly is not handed markup", async () => {
    const r = await get(PATHS.index, { accept: "application/json" });
    expect(await r.json()).toMatchObject({ service: "bench" });
  });

  test("the stylesheet and script are served, and are not HTML", async () => {
    expect((await get(PATHS.style)).headers.get("content-type")).toContain("text/css");
    expect((await get(PATHS.script)).headers.get("content-type")).toContain("javascript");
  });
});

describe("the feed", () => {
  const startRun = (agent: string, problem = "blackbox") =>
    handle(new Request("http://bench.test/attempts", {
      method: "POST", headers: { "x-agent": agent, "content-type": "application/json" },
      body: JSON.stringify({ problem, seed: 7 }),
    }), deps);

  test("it is empty before anything has happened, and says so", async () => {
    expect(await (await get(PATHS.feed)).json()).toEqual([]);
    expect(await (await get(PATHS.index, asHtml)).text()).toContain("Nothing yet");
  });

  test("a refused run is on it: the record is not only the winners", async () => {
    money.grant("agent:broke", usdc("0.01"));
    const { id } = await (await startRun("agent:broke")).json() as { id: string };
    await handle(new Request(`http://bench.test/attempts/${id}/ask`, {
      method: "POST", headers: { "x-agent": "agent:broke", "content-type": "application/json" },
      body: JSON.stringify({ side: "up", index: 0 }),
    }), deps);
    const feed = await (await get(PATHS.feed)).json() as { endedBy: string }[];
    expect(feed[0]!.endedBy).toBe("refused");
  });

  test("newest first", async () => {
    await startRun("agent:one");
    await Bun.sleep(2);
    await startRun("agent:two");
    const feed = await (await get(PATHS.feed)).json() as { agent: string }[];
    expect(feed[0]!.agent).toBe("agent:two");
  });

  test(`it stops at ${FEED_LIMIT}, so the page cannot grow without bound`, async () => {
    for (let i = 0; i < FEED_LIMIT + 5; i++) await startRun(`agent:${i}`);
    expect((await (await get(PATHS.feed)).json() as unknown[]).length).toBe(FEED_LIMIT);
  });

  test("money crosses as a string with all six places, never a number", async () => {
    await startRun(AGENT);
    const feed = await (await get(PATHS.feed)).json() as { spend: string }[];
    expect(feed[0]!.spend).toBe("0.000000");
  });
});

/**
 * An agent names itself in a header, so the name on every row is attacker-controlled. This is the
 * one thing on this page that has to be right.
 */
describe("an agent that names itself with markup", () => {
  const evil = `<img src=x onerror="alert(1)">`;

  test("it is text on the page, not a tag", async () => {
    const at = new Attempts(money);
    at.start(evil, "blackbox", 7);
    const page = renderPage(at.all(), "testnet");
    expect(page).not.toContain("<img src=x");
    expect(page).toContain("&lt;img src=x");
  });

  test("a quote in a name cannot end an attribute", () => {
    const at = new Attempts(money);
    at.start(`" autofocus onfocus="steal()`, "blackbox", 7);
    expect(renderPage(at.all(), "testnet")).not.toContain('onfocus="steal()"');
  });
});

describe("what the page says without JavaScript", () => {
  test("the first paint already carries the runs, not an empty shell", async () => {
    const at = new Attempts(money);
    at.start(AGENT, "blackbox", 7);
    const page = renderPage(at.all(), "testnet");
    expect(page).toContain(AGENT);
    expect(page).toContain("blackbox");
  });

  test("it names the network and chain it is actually serving", () => {
    expect(renderPage([], "mainnet")).toContain("eip155:5042");
    expect(renderPage([], "testnet")).toContain("eip155:5042002");
  });

  test("every problem is listed with what a question costs", () => {
    const page = renderPage([], "testnet");
    for (const id of ["Black Box", "Zendo", "Toll"]) expect(page).toContain(id);
    expect(page).toContain("ask $0.020000");
  });

  test("it links the stylesheet and script by the same constants the router serves", () => {
    const page = renderPage([], "testnet");
    expect(page).toContain(`href="${PATHS.style}"`);
    expect(page).toContain(`src="${PATHS.script}"`);
  });
});

/**
 * Bounties on the poster.
 *
 * The section is the reason a stranger reads this page: it is the money on the table. The answer
 * key must not be anywhere near it.
 */
describe("bounties on the page", () => {
  const bounty = (over: Partial<WireBounty> = {}): WireBounty => ({
    id: "b1", poster: "agent:acme", title: "Find the number",
    statement: "Work out the number we are thinking of.",
    amount: "500.000000", escrowId: "1", deadline: Date.now() + 7 * 86_400_000,
    minRating: 0, postedAt: Date.now(), solvedBy: null, solvedAt: null, awardTx: null,
    attempts: 0, open: true, awaitingPayout: false, ...over,
  });

  test("with none, the section is absent rather than empty", () => {
    expect(renderPage([], "testnet", Date.now(), [])).not.toContain("on the table");
  });

  test("the purse is the sum of what is open, in two places", () => {
    const page = renderPage([], "testnet", Date.now(), [
      bounty({ id: "b1", amount: "500.000000" }),
      bounty({ id: "b2", amount: "250.500000" }),
    ]);
    expect(page).toContain("$750.50 on the table");
  });

  test("a won bounty is not counted in what is on the table", () => {
    const page = renderPage([], "testnet", Date.now(), [
      bounty({ id: "b1", amount: "500.000000" }),
      bounty({ id: "b2", amount: "900.000000", open: false, solvedBy: "0xabc" }),
    ]);
    expect(page).toContain("$500.00 on the table");
  });

  test("the gate is said up front, not discovered on a 403", () => {
    expect(renderPage([], "testnet", Date.now(), [bounty({ minRating: 3 })]))
      .toContain("needs 3 problems solved");
    expect(renderPage([], "testnet", Date.now(), [bounty({ minRating: 1 })]))
      .toContain("needs 1 problem solved");
    expect(renderPage([], "testnet", Date.now(), [bounty({ minRating: 0 })]))
      .toContain("open to anyone");
  });

  test("a won-but-unpaid bounty says so, because both parties want to know", () => {
    const page = renderPage([], "testnet", Date.now(), [
      bounty({ open: false, solvedBy: "0xabc", awaitingPayout: true }),
    ]);
    expect(page).toContain("won · paying out");
  });

  test("open ones come first, and the biggest of those leads", () => {
    const page = renderPage([], "testnet", Date.now(), [
      bounty({ id: "b1", title: "Expired one", open: false }),
      bounty({ id: "b2", title: "Small open one", amount: "10.000000" }),
      bounty({ id: "b3", title: "Big open one", amount: "900.000000" }),
    ]);
    expect(page.indexOf("Big open one")).toBeLessThan(page.indexOf("Small open one"));
    expect(page.indexOf("Small open one")).toBeLessThan(page.indexOf("Expired one"));
  });

  test("a poster's title and statement are escaped like everything else", () => {
    const page = renderPage([], "testnet", Date.now(), [
      bounty({ title: `<img src=x onerror="alert(1)">`, statement: "<script>bad()</script>" }),
    ]);
    expect(page).not.toContain("<img src=x");
    expect(page).not.toContain("<script>bad()");
  });

  test("a very long statement is truncated rather than taking over the page", () => {
    const page = renderPage([], "testnet", Date.now(), [bounty({ statement: "x".repeat(5000) })]);
    expect(page).toContain("…");
    expect(page.length).toBeLessThan(12_000);
  });

  test("time left is shown while it is open, and not once it is not", () => {
    const now = Date.now();
    expect(renderPage([], "testnet", now, [bounty({ deadline: now + 3 * 86_400_000 })])).toContain("3d left");
    expect(renderPage([], "testnet", now, [bounty({ deadline: now + 2 * 3_600_000 })])).toContain("2h left");
    expect(renderPage([], "testnet", now, [bounty({ open: false })])).not.toContain("left");
  });
});
