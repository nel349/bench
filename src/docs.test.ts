import { expect, test, describe, beforeEach } from "bun:test";
import { handle, type Deps } from "./http.ts";
import { Attempts } from "./attempt.ts";
import { InMemoryAllowance } from "./payments.ts";
import { usdc } from "./money.ts";
import "./problems/blackbox-problem.ts";
import "./problems/zendo.ts";
import "./problems/toll.ts";

/**
 * The documentation, checked against the router.
 *
 * `docs/API.md` listed `POST /attempts/:id/rank` for weeks. The price was real, the registries were
 * real, and the route had never been written — so the one document a stranger reads first was the
 * one thing nobody ran. Prose cannot be typechecked, but it can be parsed and fired at the server.
 */
const API = await Bun.file(new URL("../docs/API.md", import.meta.url)).text();
const SKILL = await Bun.file(new URL("../skills/bench/SKILL.md", import.meta.url)).text();

/** Route lines inside fenced blocks, before the "Not built yet" heading. */
function documented(): { method: string; path: string }[] {
  const body = API.split("## Not built yet")[0]!;
  const out: { method: string; path: string }[] = [];
  for (const block of body.matchAll(/```\n([\s\S]*?)```/g)) {
    for (const line of block[1]!.split("\n")) {
      const m = /^(GET|POST|PUT|DELETE)\s+(\/\S*)/.exec(line.trim());
      if (m) out.push({ method: m[1]!, path: m[2]! });
    }
  }
  return out;
}

let deps: Deps;
beforeEach(() => {
  const money = new InMemoryAllowance();
  money.grant("agent:aria", usdc("5"));
  deps = { attempts: new Attempts(money), payments: money, net: "testnet" };
});

/** Real ids, so `:id` is exercised as a live route rather than a 404 on a made-up name. */
async function concrete(path: string): Promise<string> {
  if (!path.includes(":")) return path;
  const made = await handle(new Request("http://x/attempts", {
    method: "POST", headers: { "x-agent": "agent:aria", "content-type": "application/json" },
    body: JSON.stringify({ problem: "blackbox", seed: 7 }),
  }), deps);
  const { id } = await made.json() as { id: string };
  return path.replace(":problem", "blackbox").replace(":id", path.startsWith("/problems") ? "blackbox" : id);
}

describe("every route in docs/API.md", () => {
  const routes = documented();

  test("the doc actually lists some, so a parse failure cannot pass silently", () => {
    expect(routes.length).toBeGreaterThan(8);
  });

  for (const { method, path } of routes) {
    test(`${method} ${path} exists`, async () => {
      const url = `http://bench.test${await concrete(path)}`;
      const r = await handle(new Request(url, {
        method,
        headers: { "x-agent": "agent:aria", "content-type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify({ problem: "blackbox", seed: 7, side: "up", index: 0 }) } : {}),
      }), deps);

      // 402 is an answer: a paid route saying what it costs. Only "no route" is a missing route.
      const text = await r.text();
      expect(text).not.toContain("no route for");
      expect(r.status).not.toBe(404);
    });
  }
});

/**
 * The agent-facing skill, held to the same standard.
 *
 * It is the first thing an agent reads and the last thing anyone remembers to update, so the paths
 * in it are extracted and fired at the router exactly like the ones in the API doc.
 */
describe("every route in the agent skill", () => {
  const paths = [...new Set(
    [...SKILL.matchAll(/\$BENCH(\/[A-Za-z0-9/_$-]*)/g)].map((m) => m[1]!)
      .map((p) => p.replace(/\$AGENT/g, "agent:aria").replace(/\$ID/g, ":id"))
      .filter((p) => p.length > 1),
  )];

  test("some were found, so a parse failure cannot pass silently", () => {
    expect(paths.length).toBeGreaterThan(5);
  });

  for (const path of paths) {
    // The skill shows these three with `-XPOST`; everything else it shows is a plain GET.
    const method = /\/(ask|submit)$/.test(path) || path === "/attempts" ? "POST" : "GET";

    test(`${method} ${path} exists`, async () => {
      const r = await handle(new Request(`http://bench.test${await concrete(path)}`, {
        method,
        headers: { "x-agent": "agent:aria", "content-type": "application/json" },
        ...(method === "POST"
          ? { body: JSON.stringify({ problem: "blackbox", seed: 7, side: "up", index: 0, answer: [] }) }
          : {}),
      }), deps);
      expect(await r.text()).not.toContain("no route for");
    });
  }
});

describe("what the docs promise about prices", () => {
  test("every price named in the doc matches PRICE", async () => {
    const r = await handle(new Request("http://bench.test/problems"), deps);
    const [first] = await r.json() as { prices: { ask: string; submit: string } }[];
    expect(API).toContain(`$${first!.prices.ask.replace(/0+$/, "")}`);   // $0.02
    expect(API).toContain(`$${first!.prices.submit.replace(/0+$/, "")}`); // $0.05
  });

  test("a route the doc calls unbuilt really is unbuilt", async () => {
    expect(API).toContain("POST /attempts/:id/rank");
    const made = await handle(new Request("http://x/attempts", {
      method: "POST", headers: { "x-agent": "agent:aria", "content-type": "application/json" },
      body: JSON.stringify({ problem: "blackbox", seed: 7 }),
    }), deps);
    const { id } = await made.json() as { id: string };
    const r = await handle(new Request(`http://bench.test/attempts/${id}/rank`, {
      method: "POST", headers: { "x-agent": "agent:aria", "content-type": "application/json" },
      body: "{}",
    }), deps);
    expect(r.status).toBe(404); // if this ever passes, move it out of "Not built yet"
  });
});
