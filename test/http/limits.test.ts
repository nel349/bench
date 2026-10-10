import { expect, test, describe } from "bun:test";
import { ANONYMOUS, Attempts } from "../../src/gym/attempt.ts";
import { MemoryStore, SqliteStore, type Store } from "../../src/store/runs.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Charge, Payments } from "../../src/gym/payments.ts";
import { PRICE, submissionPrice } from "../../src/shared/pricing.ts";
import { Limiter } from "../../src/http/limits.ts";
import { handle, quoteFor, type Deps } from "../../src/http/handle.ts";
import { Bounties } from "../../src/bounties/bounties.ts";
import "../../src/problems/blackbox.ts";

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

/** Payments that settle and name nobody, so a run under them is never anybody's. */
const fromNobody: Payments = {
  async charge(_agent, amount): Promise<Charge> { return { ok: true, paid: amount, spentSoFar: 0n }; },
  spentBy: () => 0n,
};

const STORES: readonly (readonly [string, () => Store])[] = [
  ["memory", () => new MemoryStore()],
  ["sqlite", () => new SqliteStore(join(mkdtempSync(join(tmpdir(), "bench-repeats-")), "runs.sqlite"))],
];

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

  /**
   * The connector sends no label, so all its agents arrived as "anonymous", and the second one to
   * answer a problem was charged as though it were repeating the first.
   */
  test("two payers with no label each get their own free first submission", async () => {
    // One gym, so one store of counts, and each payment comes from whichever payer is current.
    let payer = "0xfirst";
    const attempts = new Attempts({
      async charge(_agent, amount): Promise<Charge> { return { ok: true, paid: amount, spentSoFar: 0n, payer }; },
      spentBy: () => 0n,
    });
    const prices: bigint[] = [];
    for (const who of ["0xfirst", "0xsecond"]) {
      payer = who;
      const a = attempts.start(ANONYMOUS, "blackbox", `seed-${who}`)!;
      await attempts.ask(a.id, { side: "up", index: 0 });      // binds this payer
      prices.push((await attempts.submit(a.id, []) as { paid: bigint }).paid);
    }
    expect(prices).toEqual([0n, 0n]);
  });

  /**
   * A label is not anyone's. Two strangers who both sent `x-agent: me`, as the README's example
   * does, shared one count, and the second paid for a first submission that should have been free.
   */
  test("two payers under one label each get their own free first submission", async () => {
    let payer = "0xfirst";
    const attempts = new Attempts({
      async charge(_agent, amount): Promise<Charge> { return { ok: true, paid: amount, spentSoFar: 0n, payer }; },
      spentBy: () => 0n,
    });
    const prices: bigint[] = [];
    for (const who of ["0xfirst", "0xsecond"]) {
      payer = who;
      const a = attempts.start("me", "blackbox", `seed-${who}`)!;
      await attempts.ask(a.id, { side: "up", index: 0 });
      prices.push((await attempts.submit(a.id, []) as { paid: bigint }).paid);
    }
    expect(prices).toEqual([0n, 0n]);
  });

  /**
   * Nor can a label be run up against whoever uses it next. However many submissions were paid for
   * under it, the most it costs a run nobody has paid into is list price, and nothing once the run
   * has a payer of its own.
   */
  test("a label someone else wore out costs a newcomer list price at most, and nothing after a question", async () => {
    let payer = "0xbusy";
    const attempts = new Attempts({
      async charge(_agent, amount): Promise<Charge> { return { ok: true, paid: amount, spentSoFar: 0n, payer }; },
      spentBy: () => 0n,
    });
    const busy = attempts.start("me", "blackbox", "seed-busy")!;
    for (let n = 0; n < 6; n++) await attempts.submit(busy.id, []);

    payer = "0xnew";
    const blind = attempts.start("me", "blackbox", "seed-blind")!;
    expect((await attempts.submit(blind.id, []) as { paid: bigint }).paid).toBe(PRICE.submit);

    payer = "0xnewer";
    const asked = attempts.start("me", "blackbox", "seed-asked")!;
    await attempts.ask(asked.id, { side: "up", index: 0 });
    expect((await attempts.submit(asked.id, []) as { paid: bigint }).paid).toBe(0n);
  });

  /**
   * A run with no label and no payer had nothing to be counted against, so it was never counted:
   * six submissions on one such run each cost nothing.
   */
  test("a run with no label still pays for its second submission, and its sixth", async () => {
    const money = fromOneAddress("0xpayer");
    const attempts = new Attempts(money);
    const a = attempts.start(ANONYMOUS, "blackbox", "seed-quiet")!;
    const prices: bigint[] = [];
    for (let n = 0; n < 6; n++) prices.push((await attempts.submit(a.id, []) as { paid: bigint }).paid);
    expect(prices).toEqual([0, 1, 2, 3, 4, 5].map(submissionPrice));
  });

  /**
   * The free submission a run made before anyone paid belongs to whoever then pays, so the address
   * does not start again from nothing on its next run.
   */
  test("what a run submitted before it was paid for counts against the address that pays", async () => {
    const attempts = new Attempts(fromOneAddress("0xpayer"));
    const first = attempts.start(ANONYMOUS, "blackbox", "seed-one")!;
    expect((await attempts.submit(first.id, []) as { paid: bigint }).paid).toBe(0n);
    await attempts.ask(first.id, { side: "up", index: 0 });      // binds the payer

    const second = attempts.start(ANONYMOUS, "blackbox", "seed-two")!;
    await attempts.ask(second.id, { side: "up", index: 0 });
    expect((await attempts.submit(second.id, []) as { paid: bigint }).paid).toBe(submissionPrice(1));
  });

  /**
   * The same when it is a submission that binds the address, not a question: the run's free one and
   * the paid one are both the address's, so its next run starts at a third.
   */
  test("and when a paid submission is what binds the address", async () => {
    const attempts = new Attempts(fromOneAddress("0xpayer"));
    const first = attempts.start(ANONYMOUS, "blackbox", "seed-one")!;
    await attempts.submit(first.id, []);                         // free, and nobody's yet
    await attempts.submit(first.id, []);                         // paid, which binds the address

    const second = attempts.start(ANONYMOUS, "blackbox", "seed-two")!;
    await attempts.ask(second.id, { side: "up", index: 0 });
    const prices = [];
    for (let n = 0; n < 2; n++) prices.push((await attempts.submit(second.id, []) as { paid: bigint }).paid);
    expect(prices).toEqual([submissionPrice(2), submissionPrice(3)]);
  });

  /**
   * The bug of 1 October, for a caller that submits before it asks: every caller that names
   * nothing arrives under one default label, which must count for nobody.
   */
  test("two unpaid runs with no label each get a free first submission", async () => {
    const attempts = new Attempts(fromOneAddress("0xpayer"));
    const prices: bigint[] = [];
    for (const seed of ["seed-a", "seed-b"]) {
      const a = attempts.start(ANONYMOUS, "blackbox", seed)!;
      prices.push((await attempts.submit(a.id, []) as { paid: bigint }).paid);
    }
    expect(prices).toEqual([0n, 0n]);
  });

  /**
   * Counts kept before 10 October rose with every submission under a label. A label one address
   * had worn out quoted a stranger $0.80 for a first submission, from the database as it stood.
   */
  for (const [kind, make] of STORES) {
    test(`a label's count from before is read as its one free submission and no more (${kind})`, async () => {
      const store = make();
      for (let n = 0; n < 6; n++) store.noteSubmission("label:me", "blackbox");
      const attempts = new Attempts(fromOneAddress("0xnew"), store);

      const blind = attempts.start("me", "blackbox", "seed-blind")!;
      expect((await attempts.submit(blind.id, []) as { paid: bigint }).paid).toBe(PRICE.submit);
    });

    test(`two payers under one label, kept in ${kind}`, async () => {
      let payer = "0xfirst";
      const attempts = new Attempts({
        async charge(_agent, amount): Promise<Charge> { return { ok: true, paid: amount, spentSoFar: 0n, payer }; },
        spentBy: () => 0n,
      }, make());
      const prices: bigint[] = [];
      for (const who of ["0xfirst", "0xsecond", "0xfirst"]) {
        payer = who;
        const a = attempts.start("me", "blackbox", `seed-${prices.length}`)!;
        await attempts.ask(a.id, { side: "up", index: 0 });
        prices.push((await attempts.submit(a.id, []) as { paid: bigint }).paid);
      }
      expect(prices).toEqual([0n, 0n, PRICE.submit]);
    });
  }

  /**
   * A run's own submissions are the least its count can be, whoever it is priced by: under a label
   * where no payment ever names an address, and for an address whose own count is behind the run.
   */
  test("a labelled run that never gets a payer still climbs by its own submissions", async () => {
    const attempts = new Attempts(fromNobody);
    const a = attempts.start("me", "blackbox", "seed-nobody")!;
    const prices: bigint[] = [];
    for (let n = 0; n < 6; n++) prices.push((await attempts.submit(a.id, []) as { paid: bigint }).paid);
    expect(prices).toEqual([0, 1, 2, 3, 4, 5].map(submissionPrice));
  });

  test("a paid run whose address has a smaller count is priced by the run's own", async () => {
    const store = new MemoryStore();
    const attempts = new Attempts(fromOneAddress("0xpayer"), store);
    const a = attempts.start(ANONYMOUS, "blackbox", "seed-carried")!;
    // A run from before the address was given what its run had submitted: three in, none counted.
    store.put({ ...store.get(a.id)!, payer: "0xpayer", submissions: 3 });
    expect((await attempts.submit(a.id, []) as { paid: bigint }).paid).toBe(submissionPrice(3));
  });

  /**
   * A submission sent in the same breath as its run's first question. The question binds the
   * address, so the submission is priced by that address's count, and has to wait its turn for it:
   * with whose count decided on the way in, it read the count while another run's submission was
   * still being paid for, and both were priced as the same one.
   */
  test("a submission behind the question that binds its run waits for that address's count", async () => {
    const waiting: { amount: bigint; release: () => void }[] = [];
    let held = false;
    const attempts = new Attempts({
      async charge(_agent, amount): Promise<Charge> {
        if (held) await new Promise<void>((release) => waiting.push({ amount, release }));
        return { ok: true, paid: amount, spentSoFar: 0n, payer: "0xpayer" };
      },
      spentBy: () => 0n,
    });
    const settle = () => new Promise((done) => setTimeout(done, 0));

    const earlier = attempts.start(ANONYMOUS, "blackbox", "seed-earlier")!;
    await attempts.ask(earlier.id, { side: "up", index: 0 });
    await attempts.submit(earlier.id, []);
    await attempts.submit(earlier.id, []);                       // the address has submitted twice
    const bound = attempts.start(ANONYMOUS, "blackbox", "seed-bound")!;
    await attempts.ask(bound.id, { side: "up", index: 0 });
    const fresh = attempts.start(ANONYMOUS, "blackbox", "seed-fresh")!;

    held = true;
    const third = attempts.submit(bound.id, []) as Promise<{ paid: bigint }>;
    const question = attempts.ask(fresh.id, { side: "up", index: 0 });
    const fourth = attempts.submit(fresh.id, []) as Promise<{ paid: bigint }>;
    await settle();
    waiting.splice(waiting.findIndex((w) => w.amount === PRICE.ask), 1)[0]!.release();
    await question;
    await settle();

    // Only the third is being paid for. The fourth has not been priced yet.
    expect(waiting.map((w) => w.amount)).toEqual([submissionPrice(2)]);
    held = false;
    waiting[0]!.release();
    expect((await third).paid).toBe(submissionPrice(2));
    expect((await fourth).paid).toBe(submissionPrice(3));
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

  for (const path of ["/rating/894767", "/funds/0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce", "/allowance/0x1/0x2",
                      "/owner/0x9fa928ACfE2eEcEad9698ebBad835E7129688b28"]) {
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
