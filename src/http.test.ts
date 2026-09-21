import { expect, test, describe, beforeEach } from "bun:test";
import { handle, type Deps } from "./http.ts";
import { Attempts } from "./attempt.ts";
import { InMemoryAllowance, type Charge, type Payments, type Quote } from "./payments.ts";
import { usdc, type Usdc } from "./money.ts";
import { PRICE } from "./pricing.ts";
import { payableOn } from "./arc/buyer.ts";
import { X402_VERSION } from "./arc/facilitator.ts";
import { boardFrom } from "./problems/blackbox.ts";
import "./problems/blackbox-problem.ts";

const AGENT = "agent:aria";
const SEED = 4242;

let money: InMemoryAllowance;
let deps: Deps;

beforeEach(() => {
  money = new InMemoryAllowance();
  money.grant(AGENT, usdc("5"));
  deps = { attempts: new Attempts(money), payments: money, net: "testnet" };
});

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  handle(new Request(`http://bench.test${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), deps);

const asAgent = { "x-agent": AGENT };
const startAttempt = async (seed = SEED) =>
  (await (await call("POST", "/attempts", { seed }, asAgent)).json()) as { id: string };

describe("the free surface is free", () => {
  test("the index names the network it serves", async () => {
    const r = await call("GET", "/");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ service: "bench", network: "testnet", chain: "eip155:5042002" });
  });

  test("problems list with their prices", async () => {
    const body = (await (await call("GET", "/problems")).json()) as { id: string; prices: { ask: string } }[];
    expect(body[0]!.id).toBe("blackbox");
    expect(body[0]!.prices.ask).toBe("0.020000");
  });

  test("the harness gives away everything needed to check a run", async () => {
    const body = (await (await call("GET", "/problems/blackbox/harness")).json()) as
      { generator: string; example: { seed: number; atoms: unknown } };
    expect(body.generator).toBe("mulberry32");
    expect(body.example.atoms).toEqual(boardFrom(1).atoms);
  });

  test("both problems are listed", async () => {
    const body = (await (await call("GET", "/problems")).json()) as { id: string }[];
    expect(body.map((p) => p.id).sort()).toEqual(["blackbox", "toll", "zendo"]);
  });

  test("nothing was charged for any of that", () => {
    expect(money.spentBy(AGENT)).toBe(0n);
  });
});

describe("starting an attempt", () => {
  /**
   * Starting a run needs no name, and requiring one was a defect.
   *
   * It contradicted the rule this API runs on — identity comes from payment — by demanding a label
   * on a free call, before anything could be proven. It also refused every agent using the only
   * real client that exists, which does not send the header, so the seller and the buyer could
   * never have met.
   */
  test("needs no agent: a run is anonymous until a payment binds it", async () => {
    const r = await call("POST", "/attempts", { seed: SEED });
    expect(r.status).toBe(201);
    const body = await r.json() as { payer: string | null };
    expect(body.payer).toBe(null);
  });

  test("a name may still be given, and is kept as a label", async () => {
    const { id } = await (await call("POST", "/attempts", { seed: SEED }, asAgent)).json() as { id: string };
    const back = await (await call("GET", `/attempts/${id}`)).json() as { payer: string | null };
    expect(back.payer).toBe(null);  // a label is not an identity
  });

  test("returns the seed, and never the board", async () => {
    const r = await call("POST", "/attempts", { seed: SEED }, asAgent);
    expect(r.status).toBe(201);
    const body = await r.text();
    expect(JSON.parse(body).seed).toBe(SEED);
    expect(body).not.toContain("atoms");
  });
});

describe("a probe", () => {
  test("charges, answers, and reports the running spend as a string", async () => {
    const a = await startAttempt();
    const r = await call("POST", `/attempts/${a.id}/ask`, { side: "left", index: 0 }, asAgent);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { paid: string; spend: string; answer: { kind: string } };
    expect(body.paid).toBe("0.020000");
    expect(body.spend).toBe("0.020000");
    expect(["hit", "reflect", "detour"]).toContain(body.answer.kind);
  });

  test("a malformed ask is a 400, not a charge", async () => {
    const a = await startAttempt();
    expect((await call("POST", `/attempts/${a.id}/ask`, { nonsense: true }, asAgent)).status).toBe(400);
    expect(money.spentBy(AGENT)).toBe(0n);
  });

  test("an unknown attempt is a 404", async () => {
    expect((await call("POST", "/attempts/nope/ask", { side: "left", index: 0 }, asAgent)).status).toBe(404);
  });
});

describe("solving", () => {
  test("the right guess solves it and returns the score", async () => {
    const a = await startAttempt();
    await call("POST", `/attempts/${a.id}/ask`, { side: "left", index: 0 }, asAgent);
    const r = await call("POST", `/attempts/${a.id}/submit`, { guess: boardFrom(SEED).atoms }, asAgent);
    const body = (await r.json()) as { solved: boolean; score: { spend: string; probes: number } };
    expect(body.solved).toBe(true);
    expect(body.score.probes).toBe(1);
    expect(body.score.spend).toBe("0.020000");
  });
});

describe("being refused is a 200, because it is a result", () => {
  test("out of allowance answers 200 with the reason and what was left", async () => {
    money.grant(AGENT, usdc("0.02"));
    const a = await startAttempt();
    await call("POST", `/attempts/${a.id}/ask`, { side: "left", index: 0 }, asAgent);
    const r = await call("POST", `/attempts/${a.id}/ask`, { side: "left", index: 1 }, asAgent);

    expect(r.status).toBe(200);
    const body = (await r.json()) as { refused: string; wanted: string; remaining: string };
    expect(body.refused).toBe("allowance");
    expect(body.wanted).toBe("0.020000");
    expect(body.remaining).toBe("0.000000");
  });
});

/** A payments implementation that always wants paying first, the way x402 does. */
class WantsPayment implements Payments {
  seen: string[] = [];
  readonly quote: Quote = {
    amount: usdc("0.02"), chain: "eip155:5042002",
    token: "0x3600000000000000000000000000000000000000",
    payTo: "0x0000000000000000000000000000000000000001", scheme: "exact",
  };
  async charge(_a: string, amount: Usdc, _r: string, proof?: string | null): Promise<Charge> {
    this.seen.push(proof ?? "<none>");
    if (!proof) return { ok: false, needsPayment: { ...this.quote, amount } };
    return { ok: true, paid: amount, spentSoFar: amount };
  }
  spentBy(): Usdc { return 0n; }
}

describe("x402: no proof means 402, and the retry succeeds", () => {
  let wants: WantsPayment;
  beforeEach(() => {
    wants = new WantsPayment();
    deps = { attempts: new Attempts(wants), payments: wants, net: "testnet" };
  });

  /**
   * The 402 has to be payable, not merely well-shaped.
   *
   * The earlier version of this test asserted the fields we happened to emit — `x402Version: 1` and
   * `maxAmountRequired` — and passed for weeks while no real agent could have paid a single quote.
   * The buyer is the judge now: if `payableOn` cannot find terms it can sign, the quote is wrong,
   * whatever it looks like.
   */
  test("the first ask answers 402 with a quote a real buyer can act on", async () => {
    const a = await startAttempt();
    const r = await call("POST", `/attempts/${a.id}/ask`, { side: "left", index: 0 }, asAgent);
    expect(r.status).toBe(402);

    const body = await r.json() as { x402Version: number; resource: Record<string, string> };
    expect(body.x402Version).toBe(X402_VERSION);
    // Circle rejects a payment whose payload has no resource, and a buyer reads it from here.
    // It has to be an object with all three fields: a bare URL is refused by the facilitator.
    expect(body.resource.url).toBe(`/attempts/${a.id}/ask`);
    expect((body.resource.description ?? "").length).toBeGreaterThan(0);
    expect(body.resource.mimeType).toBe("application/json");

    const terms = payableOn("testnet", body);
    expect(terms).not.toBe(null);
    expect(terms!.amount).toBe(PRICE.ask.toString());
    expect(terms!.payTo.length).toBeGreaterThan(0);
  });

  test("the price is under `amount`, which is the field a buyer reads", async () => {
    const a = await startAttempt();
    const body = await (await call("POST", `/attempts/${a.id}/ask`, { side: "left", index: 0 }, asAgent)).json() as
      { accepts: Record<string, unknown>[] };
    expect(body.accepts[0]!["amount"]).toBe(PRICE.ask.toString());
  });

  test("a 402 charged nothing and left the run open", async () => {
    const a = await startAttempt();
    await call("POST", `/attempts/${a.id}/ask`, { side: "left", index: 0 }, asAgent);
    const after = (await (await call("GET", `/attempts/${a.id}`)).json()) as { outcome: string; spend: string };
    expect(after.outcome).toBe("open");
    expect(after.spend).toBe("0.000000");
  });

  test("asking again with a payment header goes through", async () => {
    const a = await startAttempt();
    await call("POST", `/attempts/${a.id}/ask`, { side: "left", index: 0 }, asAgent);
    const r = await call("POST", `/attempts/${a.id}/ask`, { side: "left", index: 0 },
                         { ...asAgent, "x-payment": "signed-authorisation" });
    expect(r.status).toBe(200);
    expect(wants.seen).toEqual(["<none>", "signed-authorisation"]);
  });
});

describe("the boards", () => {
  test("an agent's page totals its runs", async () => {
    const a = await startAttempt();
    await call("POST", `/attempts/${a.id}/ask`, { side: "left", index: 0 }, asAgent);
    await call("POST", `/attempts/${a.id}/submit`, { guess: boardFrom(SEED).atoms }, asAgent);
    const body = (await (await call("GET", `/agents/${AGENT}`)).json()) as
      { solved: number; attempts: number; spend: string };
    expect(body.solved).toBe(1);
    expect(body.attempts).toBe(1);
    expect(body.spend).toBe("0.020000");
  });

  test("the leaderboard ranks by cost to solve, cheapest first", async () => {
    for (const [agent, probes] of [["agent:thrifty", 1], ["agent:spendy", 5]] as const) {
      money.grant(agent, usdc("5"));
      const started = (await (await call("POST", "/attempts", { seed: SEED }, { "x-agent": agent })).json()) as { id: string };
      for (let i = 0; i < probes; i++) {
        await call("POST", `/attempts/${started.id}/ask`, { side: "left", index: i }, { "x-agent": agent });
      }
      await call("POST", `/attempts/${started.id}/submit`, { guess: boardFrom(SEED).atoms }, { "x-agent": agent });
    }
    const board = (await (await call("GET", "/leaderboard/blackbox")).json()) as { agent: string; spend: string }[];
    expect(board.map((r) => r.agent)).toEqual(["agent:thrifty", "agent:spendy"]);
    expect(board[0]!.spend).toBe("0.020000");
  });

  test("an unsolved run never appears on the board", async () => {
    money.grant("agent:quitter", usdc("1"));
    const started = (await (await call("POST", "/attempts", { seed: SEED }, { "x-agent": "agent:quitter" })).json()) as { id: string };
    await call("POST", `/attempts/${started.id}/ask`, { side: "left", index: 0 }, { "x-agent": "agent:quitter" });
    const board = (await (await call("GET", "/leaderboard/blackbox")).json()) as unknown[];
    expect(board).toHaveLength(0);
  });
});

describe("a finished run says so, rather than throwing", () => {
  test("asking again after solving is a 409, not a 500", async () => {
    const a = await startAttempt();
    await call("POST", `/attempts/${a.id}/submit`, { guess: boardFrom(SEED).atoms }, asAgent);
    const r = await call("POST", `/attempts/${a.id}/ask`, { side: "left", index: 0 }, asAgent);
    expect(r.status).toBe(409);
    expect((await r.json()) as { error: string }).toMatchObject({ error: "this attempt is solved" });
  });

  test("a malformed probe on a finished run is still a 409, and still free", async () => {
    const a = await startAttempt();
    await call("POST", `/attempts/${a.id}/submit`, { guess: boardFrom(SEED).atoms }, asAgent);
    const before = money.spentBy(AGENT);
    expect((await call("POST", `/attempts/${a.id}/ask`, { nonsense: true }, asAgent)).status).toBe(409);
    expect(money.spentBy(AGENT)).toBe(before);
  });

  test("submitting to a refused run is a 409", async () => {
    money.grant(AGENT, usdc("0.02"));
    const a = await startAttempt();
    await call("POST", `/attempts/${a.id}/ask`, { side: "left", index: 0 }, asAgent);
    await call("POST", `/attempts/${a.id}/ask`, { side: "left", index: 1 }, asAgent);
    const r = await call("POST", `/attempts/${a.id}/submit`, { guess: boardFrom(SEED).atoms }, asAgent);
    expect(r.status).toBe(409);
  });
});

describe("unknown routes", () => {
  test("say so", async () => {
    expect((await call("GET", "/nope")).status).toBe(404);
  });
});

/**
 * The budget, which was enforceable and unreachable.
 *
 * `Attempt.budget` was stored, returned, and checked on every spend from the first commit — and no
 * route ever parsed it, so every run over HTTP started uncapped. The lifecycle tests all passed,
 * because they call `start()` directly. Found by setting a budget over the wire and watching three
 * probes sail past it.
 */
describe("a run's own budget", () => {
  const start = (budget?: unknown) =>
    call("POST", "/attempts", { seed: SEED, ...(budget === undefined ? {} : { budget }) }, asAgent);

  test("a budget set at the start comes back on the attempt", async () => {
    const r = await start("0.05");
    expect(r.status).toBe(201);
    expect((await r.json() as { budget: string }).budget).toBe("0.050000");
  });

  test("no budget is no cap, not a zero cap", async () => {
    expect((await (await start()).json() as { budget: string | null }).budget).toBe(null);
  });

  test("it actually refuses the probe that would cross it", async () => {
    const { id } = await (await start("0.05")).json() as { id: string };
    const ask = (index: number) =>
      call("POST", `/attempts/${id}/ask`, { side: "up", index }, asAgent);

    await ask(0); // 0.02
    await ask(1); // 0.04
    const body = await (await ask(2)).json() as { refused?: string; remaining?: string };
    expect(body.refused).toBe("budget"); // 0.06 would cross it
    expect(body.remaining).toBe("0.010000");
  });

  test("a number is refused, because money is never a float here", async () => {
    const r = await start(0.05);
    expect(r.status).toBe(400);
    expect((await r.json() as { error: string }).error).toContain("decimal string");
  });

  test("nonsense is a 400, not a 500 out of the error boundary", async () => {
    expect((await start("half a dollar")).status).toBe(400);
  });

  test("zero is refused, since it could never buy anything", async () => {
    expect((await start("0")).status).toBe(400);
  });
});

/**
 * One agent, one record, whichever endpoint you ask.
 *
 * `/agents/:id` filtered on the header label while `/rating/:id` matched the payer or the label, so
 * the same agent existed on one and not the other. One of those is the identity money proves.
 */
describe("who an agent is, consistently", () => {
  const PAYER = "0xabc0000000000000000000000000000000000001";

  const runWithPayer = async () => {
    const { id } = await (await call("POST", "/attempts", { seed: SEED }, asAgent)).json() as { id: string };
    const a = deps.attempts.get(id)!;
    a.payer = PAYER;                       // as the first payment would have bound it
    await call("POST", `/attempts/${id}/ask`, { side: "up", index: 0 }, asAgent);
    return id;
  };

  test("the address that paid finds the record on both", async () => {
    await runWithPayer();
    const agents = await (await call("GET", `/agents/${PAYER}`)).json() as { attempts: number };
    const rating = await (await call("GET", `/rating/${PAYER}`)).json() as { attempted: number };
    expect(agents.attempts).toBe(1);
    expect(rating.attempted).toBe(1);
  });

  test("and so does the label, on both", async () => {
    await runWithPayer();
    const agents = await (await call("GET", `/agents/${AGENT}`)).json() as { attempts: number };
    const rating = await (await call("GET", `/rating/${AGENT}`)).json() as { attempted: number };
    expect(agents.attempts).toBe(1);
    expect(rating.attempted).toBe(1);
  });

  test("a stranger finds nothing on either", async () => {
    await runWithPayer();
    const agents = await (await call("GET", "/agents/0xdead")).json() as { attempts: number };
    const rating = await (await call("GET", "/rating/0xdead")).json() as { attempted: number };
    expect(agents.attempts).toBe(0);
    expect(rating.attempted).toBe(0);
  });
});
