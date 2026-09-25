import { expect, test, describe } from "bun:test";
import { Attempts } from "./attempt.ts";
import type { Charge, Payments } from "./payments.ts";
import { PRICE, submissionPrice } from "./pricing.ts";
import { Limiter } from "./limits.ts";
import { handle, quoteFor, type Deps } from "./http.ts";
import { Bounties } from "./bounties.ts";
import "./problems/blackbox-problem.ts";

/** Payments that always succeed from one address, whatever label the caller sends, as on chain. */
function fromOneAddress(payer: string): Payments & { readonly charged: bigint[] } {
  const charged: bigint[] = [];
  return {
    charged,
    async charge(_agent, amount): Promise<Charge> {
      charged.push(amount);
      return { ok: true, paid: amount, spentSoFar: 0n, payer };
    },
    spentBy: () => 0n,
  };
}

describe("repeats are counted per paying address, not per label", () => {
  /**
   * The hole: the rising price of a repeat was counted per X-Agent label, which anyone can change.
   * One address rotating labels got a fresh free first submission, and list price, every time.
   */
  test("one payer, three labels: the third submission is priced as a third", async () => {
    const money = fromOneAddress("0xpayer");
    const attempts = new Attempts(money);
    const prices: bigint[] = [];
    for (const label of ["agent:one", "agent:two", "agent:three"]) {
      const a = attempts.start(label, "blackbox", `seed-${label}`)!;
      await attempts.ask(a.id, { side: "up", index: 0 });      // binds the payer
      const out = await attempts.submit(a.id, []) as { paid: bigint };
      prices.push(out.paid);
    }
    expect(prices).toEqual([submissionPrice(0), submissionPrice(1), submissionPrice(2)]);
    expect(prices[0]).toBe(0n);
    expect(prices[1]).toBe(PRICE.submit);
  });
});

describe("the limiter", () => {
  test("allows up to its capacity, then says how long to wait", () => {
    const l = new Limiter(3, 60_000);
    for (let i = 0; i < 3; i++) expect(l.take("k", 0)).toEqual({ ok: true });
    const refused = l.take("k", 0);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.retryAfterMs).toBe(20_000);
  });
  test("refills with time, and keys do not share", () => {
    const l = new Limiter(2, 60_000);
    l.take("k", 0); l.take("k", 0);
    expect(l.take("other", 0).ok).toBe(true);
    expect(l.take("k", 30_000).ok).toBe(true);
    expect(l.take("k", 30_000).ok).toBe(false);
  });
  test("checking does not spend", () => {
    const l = new Limiter(1, 60_000);
    expect(l.allows("k", 0)).toBe(true);
    expect(l.allows("k", 0)).toBe(true);
    expect(l.take("k", 0).ok).toBe(true);
    expect(l.allows("k", 0)).toBe(false);
  });
});

describe("limits at the door", () => {
  const deps = (graded = 100, free = 100): Deps => {
    const money = fromOneAddress("0xpayer");
    return { attempts: new Attempts(money), payments: money, net: "testnet",
             limits: { free: new Limiter(free, 60_000), graded: new Limiter(graded, 3_600_000),
                       refused: new Limiter(100, 60_000) } };
  };
  const post = (d: Deps, path: string, body?: unknown, client = "10.0.0.1") =>
    handle(new Request(`http://bench.test${path}`, { method: "POST",
      headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), d, client);

  test("starting runs is capped per client per minute, with a wait, and other clients are unaffected", async () => {
    const d = deps(100, 2);
    expect((await post(d, "/attempts")).status).toBe(201);
    expect((await post(d, "/attempts")).status).toBe(201);
    const capped = await post(d, "/attempts");
    expect(capped.status).toBe(429);
    expect(Number(capped.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await post(d, "/attempts", undefined, "10.0.0.2")).status).toBe(201);
  });

  test("graded submissions are capped per payer per hour, refused before anything is charged", async () => {
    const d = deps(2);
    const money = d.payments as ReturnType<typeof fromOneAddress>;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { id } = await (await post(d, "/attempts", {}, `10.0.1.${i}`)).json() as { id: string };
      await post(d, `/attempts/${id}/ask`, { side: "up", index: 0 });
      ids.push(id);
    }
    expect((await post(d, `/attempts/${ids[0]}/submit`, { answer: [] })).status).toBe(200);
    expect((await post(d, `/attempts/${ids[1]}/submit`, { answer: [] })).status).toBe(200);
    const before = money.charged.length;
    const capped = await post(d, `/attempts/${ids[2]}/submit`, { answer: [] }, "10.9.9.9");
    expect(capped.status).toBe(429);
    expect(await capped.json()).toMatchObject({ charged: false });
    expect(money.charged.length).toBe(before);
  });

  test("the harness is capped per client too", async () => {
    const d = deps(100, 1);
    const get = () => handle(new Request("http://bench.test/problems/blackbox/harness"), d, "10.0.0.3");
    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(429);
  });
});

describe("free requests that reach the chain or Circle are capped too", () => {
  const deps = (): Deps => {
    const money = fromOneAddress("0xpayer");
    return { attempts: new Attempts(money), payments: money, net: "testnet",
             limits: { free: new Limiter(2, 60_000), graded: new Limiter(100, 3_600_000), refused: new Limiter(1, 60_000) } };
  };
  const get = (d: Deps, path: string, client = "10.0.0.7") => handle(new Request(`http://bench.test${path}`), d, client);

  for (const path of ["/rating/894767", "/funds/0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce", "/allowance/0x1/0x2"]) {
    test(`${path.split("/")[1]} is capped per client`, async () => {
      const d = deps();
      await get(d, path); await get(d, path);
      expect((await get(d, path)).status).toBe(429);
      expect((await get(d, path, "10.0.0.8")).status).not.toBe(429);
    });
  }

  test("posting a bounty is capped per client", async () => {
    const d = { ...deps(), bounties: new Bounties() };
    const post = () => handle(new Request("http://bench.test/bounties", { method: "POST",
      headers: { "content-type": "application/json" }, body: "{}" }), d, "10.0.0.9");
    await post(); await post();
    expect((await post()).status).toBe(429);
  });

  /**
   * A payment that fails verification costs us a call to Circle and the sender nothing, so a script
   * sending bad signatures is stopped after a few; a payment that works never counts.
   */
  test("refused payments are capped per client, and good ones never count", async () => {
    const refusing: Payments = {
      charge: async (): Promise<Charge> => ({ ok: false, refused: "payment", reason: "bad signature",
        quote: quoteFor("testnet", PRICE.ask, "0x0000000000000000000000000000000000000001") }),
      spentBy: () => 0n,
    };
    const d: Deps = { attempts: new Attempts(refusing), payments: refusing, net: "testnet",
                      limits: { free: new Limiter(100, 60_000), graded: new Limiter(100, 3_600_000), refused: new Limiter(1, 60_000) } };
    const { id } = await (await handle(new Request("http://bench.test/attempts", { method: "POST" }), d, "10.1.1.1")).json() as { id: string };
    const ask = () => handle(new Request(`http://bench.test/attempts/${id}/ask`, { method: "POST",
      headers: { "content-type": "application/json", "payment-signature": "bad" }, body: JSON.stringify({ side: "up", index: 0 }) }), d, "10.1.1.1");
    expect((await ask()).status).toBe(402);
    expect((await ask()).status).toBe(429);

    const good = deps();
    const { id: run } = await (await handle(new Request("http://bench.test/attempts", { method: "POST" }), good, "10.1.1.2")).json() as { id: string };
    for (let i = 0; i < 3; i++) {
      const r = await handle(new Request(`http://bench.test/attempts/${run}/ask`, { method: "POST",
        headers: { "content-type": "application/json", "payment-signature": "fine" }, body: JSON.stringify({ side: "up", index: i }) }), good, "10.1.1.2");
      expect(r.status).toBe(200);
    }
  });
});
