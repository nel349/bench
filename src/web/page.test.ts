import { expect, test, describe, beforeEach } from "bun:test";
import { handle, type Deps } from "../http.ts";
import { Attempts } from "../attempt.ts";
import { InMemoryAllowance } from "../payments.ts";
import { usdc } from "../money.ts";
import { renderPage } from "./page.ts";
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
