import { expect, test, describe, beforeEach } from "bun:test";
import { handle, type Deps } from "./http.ts";
import { Attempts } from "./attempt.ts";
import { InMemoryAllowance, type Charge, type Payments, type Quote } from "./payments.ts";
import { usdc, type Usdc } from "./money.ts";
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
    expect(body.map((p) => p.id).sort()).toEqual(["blackbox", "zendo"]);
  });

  test("nothing was charged for any of that", () => {
    expect(money.spentBy(AGENT)).toBe(0n);
  });
});

describe("starting an attempt", () => {
  test("needs an agent", async () => {
    expect((await call("POST", "/attempts", { seed: SEED })).status).toBe(401);
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

  test("the first ask answers 402 with a quote a client can act on", async () => {
    const a = await startAttempt();
    const r = await call("POST", `/attempts/${a.id}/ask`, { side: "left", index: 0 }, asAgent);
    expect(r.status).toBe(402);
    const body = (await r.json()) as { x402Version: number; accepts: { network: string; payTo: string; maxAmountRequired: string }[] };
    expect(body.x402Version).toBe(1);
    expect(body.accepts[0]!.network).toBe("eip155:5042002");
    expect(body.accepts[0]!.maxAmountRequired).toBe("20000");
    expect(body.accepts[0]!.payTo).toMatch(/^0x[0-9a-fA-F]{40}$/);
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

describe("unknown routes", () => {
  test("say so", async () => {
    expect((await call("GET", "/nope")).status).toBe(404);
  });
});
