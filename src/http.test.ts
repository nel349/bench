import { expect, test, describe, beforeEach } from "bun:test";
import { handle, quoteFor, type Deps } from "./http.ts";
import { Attempts, recordHash } from "./attempt.ts";
import { SqliteStore } from "./store.ts";
import { InMemoryAllowance, type Charge, type Payments, type Quote } from "./payments.ts";
import { usdc, type Usdc } from "./money.ts";
import { PRICE } from "./pricing.ts";
import { payableOn } from "./arc/buyer.ts";
import { b64, REQUIRED_HEADER, X402_VERSION } from "./arc/facilitator.ts";
import { boardFrom, fire, type Port } from "./problems/blackbox.ts";
import { ruleFor } from "./problems/zendo.ts";
import { mazeFrom, shortestRoute, type Walls } from "./problems/toll.ts";
import { fingerprint } from "./problems/seed.ts";
import { GENERATOR } from "./problems/problem.ts";
import { MemoryReputation } from "./reputation.ts";
import { Bounties } from "./bounties.ts";
import type { ProblemWire } from "./wire.ts";
import "./problems/blackbox-problem.ts";

const AGENT = "agent:aria";

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
const startAttempt = async () =>
  (await (await call("POST", "/attempts", {}, asAgent)).json()) as { id: string };

/**
 * The answer to a run, worked out from the seed the server is keeping secret.
 *
 * Only a test may do this, because only a test can reach into the server's own records. Anything a
 * response carries is exactly what an agent sees, and that is what `FINDINGS.md` 26 was about.
 */
const solutionOf = (id: string) => boardFrom(deps.attempts.get(id)!.seed).atoms;

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
      { generator: string; example: { seed: string; atoms: unknown } };
    expect(body.generator).toBe(GENERATOR);
    expect(body.example.atoms).toEqual(boardFrom("1").atoms);
  });

  test("any text is a seed at the harness, for practice", async () => {
    const body = (await (await call("GET", "/problems/blackbox/harness?seed=my%20practice")).json()) as
      { seed: string; example: { atoms: unknown } };
    expect(body.seed).toBe("my practice");
    expect(body.example.atoms).toEqual(boardFrom("my practice").atoms);
  });

  test("all seven problems are listed, each with its level and par", async () => {
    const body = (await (await call("GET", "/problems")).json()) as ProblemWire[];
    expect(body.map((p) => p.id).sort()).toEqual(["bisect", "blackbox", "codebreaker", "liar", "ranking", "toll", "zendo"]);
    const levels = new Set(body.map((p) => p.level));
    expect([...levels].sort()).toEqual(["easy", "hard", "medium"]);
    expect(body.find((p) => p.id === "ranking")!.par).toBe(16);
    expect(body.find((p) => p.id === "zendo")!.par).toBe(null);
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
    const r = await call("POST", "/attempts", {});
    expect(r.status).toBe(201);
    const body = await r.json() as { payer: string | null };
    expect(body.payer).toBe(null);
  });

  test("a name may still be given, and is kept as a label", async () => {
    const { id } = await (await call("POST", "/attempts", {}, asAgent)).json() as { id: string };
    const back = await (await call("GET", `/attempts/${id}`)).json() as { payer: string | null };
    expect(back.payer).toBe(null);  // a label is not an identity
  });

  test("shows a fingerprint, and neither the seed nor the board", async () => {
    const r = await call("POST", "/attempts", {}, asAgent);
    expect(r.status).toBe(201);
    const body = await r.text();
    const { id, seed, fingerprint: shown } = JSON.parse(body) as { id: string; seed: string | null; fingerprint: string };
    const secret = deps.attempts.get(id)!.seed;
    expect(seed).toBe(null);
    expect(body).not.toContain(secret);
    expect(shown).toBe(fingerprint(secret));
    expect(body).not.toContain("atoms");
  });

  test("a seed chosen by the agent is refused, and points at the free harness", async () => {
    const r = await call("POST", "/attempts", { problem: "toll", seed: 4242 }, asAgent);
    expect(r.status).toBe(400);
    expect((await r.json() as { error: string }).error).toContain("/problems/toll/harness?seed=");
  });
});

/**
 * The attack in `FINDINGS.md` 26, kept as a test so it stays closed.
 *
 * Start a run on each problem, rebuild the instance from everything any response has said about the
 * run, and submit. Before the fix this solved all three with no probes and nothing spent.
 */
describe("a run cannot be solved from what it shows you", () => {
  const answerFrom = (problem: string, seed: string): unknown => {
    if (problem === "blackbox") return boardFrom(seed).atoms;
    if (problem === "zendo") return ruleFor(seed).name;
    return shortestRoute(mazeFrom(seed)).join("");
  };

  for (const problem of ["blackbox", "zendo", "toll"]) {
    test(`${problem}: nothing any response carries rebuilds the instance`, async () => {
      const started = await (await call("POST", "/attempts", { problem }, asAgent)).json() as Record<string, unknown>;
      const id = started["id"] as string;
      const seen = [
        JSON.stringify(started),
        await (await call("GET", `/attempts/${id}`)).text(),
        await (await call("GET", "/feed")).text(),
        await (await call("GET", `/agents/${AGENT}`)).text(),
      ].join("\n");
      expect(seen).not.toContain(deps.attempts.get(id)!.seed);

      // Every string a response carried, tried as a seed. None of them is the one that matters.
      const candidates = new Set(seen.match(/"[^"]*"/g)!.map((q) => q.slice(1, -1)));
      for (const guess of candidates) {
        const r = await call("POST", `/attempts/${id}/submit`, { answer: answerFrom(problem, guess) }, asAgent);
        const body = await r.json() as { solved?: boolean };
        expect(body.solved).not.toBe(true);
        if (deps.attempts.get(id)!.outcome !== "open") break;
      }
    });
  }

  test("once a run is over its seed is published, matches the fingerprint, and replays the run", async () => {
    const a = await startAttempt();
    const probe = { side: "left", index: 3 };
    const asked = await (await call("POST", `/attempts/${a.id}/ask`, probe, asAgent)).json() as { answer: unknown };
    const before = await (await call("GET", `/attempts/${a.id}`)).json() as { seed: string | null; fingerprint: string };
    expect(before.seed).toBe(null);

    await call("POST", `/attempts/${a.id}/submit`, { guess: solutionOf(a.id) }, asAgent);
    const after = await (await call("GET", `/attempts/${a.id}`)).json() as { seed: string; fingerprint: string };
    expect(after.seed).not.toBe(null);
    expect(fingerprint(after.seed)).toBe(before.fingerprint);

    // A stranger, with nothing but the revealed seed and the free harness.
    const harness = await (await call("GET", `/problems/blackbox/harness?seed=${after.seed}`)).json() as
      { fingerprint: string; example: { atoms: unknown } };
    expect(harness.fingerprint).toBe(before.fingerprint);
    expect(asked.answer).toEqual(fire(boardFrom(after.seed), probe as Port));
    expect(harness.example.atoms).toEqual(solutionOf(a.id));
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
    const r = await call("POST", `/attempts/${a.id}/submit`, { guess: solutionOf(a.id) }, asAgent);
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
  /**
   * x402 version 2 carries the quote in a `PAYMENT-REQUIRED` header, base64 JSON, and the
   * arc-mandate connector reads it from there and nowhere else. We sent it only in the body, so the
   * connector refused every quote with "the seller asked for payment without saying how much".
   * Found when the connector itself was pointed at the testnet gym; our own buyer reads the body.
   */
  test("the quote is in the PAYMENT-REQUIRED header as well as the body, identically", async () => {
    const a = await startAttempt();
    const r = await call("POST", `/attempts/${a.id}/ask`, { side: "left", index: 0 }, asAgent);
    const header = r.headers.get(REQUIRED_HEADER);
    expect(header).not.toBe(null);
    expect(b64.decode(header!)).toEqual(await r.json());
  });

  test("a refused payment answers the same version-2 quote, header included", async () => {
    // A payment side that refuses every payment, as Circle does a bad signature.
    const refusing: Payments = {
      charge: async (): Promise<Charge> => ({ ok: false, refused: "payment", reason: "bad signature",
        quote: quoteFor("testnet", PRICE.ask, "0x0000000000000000000000000000000000000001") }),
      spentBy: () => 0n,
    };
    const rejecting: Deps = { ...deps, attempts: new Attempts(refusing), payments: refusing };
    const { id } = await (await handle(new Request("http://bench.test/attempts", { method: "POST" }), rejecting)).json() as { id: string };
    const r = await handle(new Request(`http://bench.test/attempts/${id}/ask`, {
      method: "POST", headers: { "content-type": "application/json", "payment-signature": "x" },
      body: JSON.stringify({ side: "left", index: 0 }) }), rejecting);
    expect(r.status).toBe(402);
    const body = await r.json() as { x402Version: number; resource: { url: string }; error: string };
    expect(body.x402Version).toBe(X402_VERSION);
    expect(body.resource.url).toBe(`/attempts/${id}/ask`);
    expect(body.error).toContain("bad signature");
    expect(b64.decode(r.headers.get(REQUIRED_HEADER)!)).toEqual(body);
  });

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
    await call("POST", `/attempts/${a.id}/submit`, { guess: solutionOf(a.id) }, asAgent);
    const body = (await (await call("GET", `/agents/${AGENT}`)).json()) as
      { solved: number; attempts: number; spend: string };
    expect(body.solved).toBe(1);
    expect(body.attempts).toBe(1);
    expect(body.spend).toBe("0.020000");
  });

  test("the leaderboard ranks by cost to solve, cheapest first", async () => {
    for (const [agent, probes] of [["agent:thrifty", 1], ["agent:spendy", 5]] as const) {
      money.grant(agent, usdc("5"));
      const started = (await (await call("POST", "/attempts", {}, { "x-agent": agent })).json()) as { id: string };
      for (let i = 0; i < probes; i++) {
        await call("POST", `/attempts/${started.id}/ask`, { side: "left", index: i }, { "x-agent": agent });
      }
      await call("POST", `/attempts/${started.id}/submit`, { guess: solutionOf(started.id) }, { "x-agent": agent });
    }
    const board = (await (await call("GET", "/leaderboard/blackbox")).json()) as { agent: string; spend: string }[];
    expect(board.map((r) => r.agent)).toEqual(["agent:thrifty", "agent:spendy"]);
    expect(board[0]!.spend).toBe("0.020000");
  });

  /**
   * A first submission is free, so a run can be solved by a lucky guess with nothing paid. Such a
   * run is nobody's, and on the board it would sit at $0.00 above every honest solve.
   */
  test("a solve nobody paid for never appears on the board", async () => {
    money.grant("agent:lucky", usdc("1"));
    const started = (await (await call("POST", "/attempts", {}, { "x-agent": "agent:lucky" })).json()) as { id: string };
    const r = await (await call("POST", `/attempts/${started.id}/submit`, { guess: solutionOf(started.id) }, { "x-agent": "agent:lucky" })).json() as { solved: boolean };
    expect(r.solved).toBe(true);
    const board = (await (await call("GET", "/leaderboard/blackbox")).json()) as unknown[];
    expect(board).toHaveLength(0);
  });

  /**
   * Starting a run is free, so a feed that listed every run could be filled by anyone for nothing.
   * Found on the testnet page: empty "anonymous" rows from runs that never bought a probe.
   */
  test("the feed shows runs someone paid for, refusals included, and not runs nobody paid for", async () => {
    await call("POST", "/attempts", {}, asAgent);                                  // started, never paid
    const paid = await startAttempt();
    await call("POST", `/attempts/${paid.id}/ask`, { side: "left", index: 0 }, asAgent);
    const feed = (await (await call("GET", "/feed")).json()) as { attempt: string }[];
    expect(feed.map((r) => r.attempt)).toEqual([paid.id]);
  });

  test("an unsolved run never appears on the board", async () => {
    money.grant("agent:quitter", usdc("1"));
    const started = (await (await call("POST", "/attempts", {}, { "x-agent": "agent:quitter" })).json()) as { id: string };
    await call("POST", `/attempts/${started.id}/ask`, { side: "left", index: 0 }, { "x-agent": "agent:quitter" });
    const board = (await (await call("GET", "/leaderboard/blackbox")).json()) as unknown[];
    expect(board).toHaveLength(0);
  });
});

describe("a finished run says so, rather than throwing", () => {
  test("asking again after solving is a 409, not a 500", async () => {
    const a = await startAttempt();
    await call("POST", `/attempts/${a.id}/submit`, { guess: solutionOf(a.id) }, asAgent);
    const r = await call("POST", `/attempts/${a.id}/ask`, { side: "left", index: 0 }, asAgent);
    expect(r.status).toBe(409);
    expect((await r.json()) as { error: string }).toMatchObject({ error: "this attempt is solved" });
  });

  test("a malformed probe on a finished run is still a 409, and still free", async () => {
    const a = await startAttempt();
    await call("POST", `/attempts/${a.id}/submit`, { guess: solutionOf(a.id) }, asAgent);
    const before = money.spentBy(AGENT);
    expect((await call("POST", `/attempts/${a.id}/ask`, { nonsense: true }, asAgent)).status).toBe(409);
    expect(money.spentBy(AGENT)).toBe(before);
  });

  test("submitting to a refused run is a 409", async () => {
    money.grant(AGENT, usdc("0.02"));
    const a = await startAttempt();
    await call("POST", `/attempts/${a.id}/ask`, { side: "left", index: 0 }, asAgent);
    await call("POST", `/attempts/${a.id}/ask`, { side: "left", index: 1 }, asAgent);
    const r = await call("POST", `/attempts/${a.id}/submit`, { guess: solutionOf(a.id) }, asAgent);
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
    call("POST", "/attempts", { ...(budget === undefined ? {} : { budget }) }, asAgent);

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
/**
 * Ranked runs and the gate that reads them, through the routes.
 *
 * The ledger here is the in-memory one, and identities are checked by a rule written in the test:
 * id 42 is paid for by AGENT and nothing else. Everything else is the real router.
 */
describe("ranking a run, and the bounty gate reading the ledger", () => {
  const ID = "42";
  let ledger: MemoryReputation;
  let bounties: Bounties;
  let ranked: Deps;

  beforeEach(() => {
    ledger = new MemoryReputation();
    bounties = new Bounties();
    const verify = async (id: bigint, payer: string) => id === 42n && payer === AGENT;
    ranked = { attempts: new Attempts(money, undefined, verify), payments: money, net: "testnet",
               bounties, reputation: ledger, verifyIdentity: verify };
  });

  const as = (headers: Record<string, string>) => ({ ...asAgent, ...headers });
  const callRanked = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    handle(new Request(`http://bench.test${path}`, {
      method, headers: { "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), ranked);

  const solved = async (headers: Record<string, string> = as({ "x-agent-id": ID })) => {
    const { id } = await (await callRanked("POST", "/attempts", {}, headers)).json() as { id: string };
    await callRanked("POST", `/attempts/${id}/ask`, { side: "up", index: 0 }, headers);
    const seed = ranked.attempts.get(id)!.seed;
    await callRanked("POST", `/attempts/${id}/submit`, { answer: boardFrom(seed).atoms }, headers);
    return id;
  };

  test("a solved run under a proven identity ranks for $0.25, and the record reads back by id", async () => {
    const id = await solved();
    const before = money.spentBy(AGENT);
    const r = await callRanked("POST", `/attempts/${id}/rank`, {}, as({ "x-agent-id": ID }));
    expect(r.status).toBe(200);
    const body = await r.json() as { ranked: boolean; paid: string; attempt: { ranked: { tx: string } } };
    expect(body.ranked).toBe(true);
    expect(body.paid).toBe("0.250000");
    expect(money.spentBy(AGENT) - before).toBe(PRICE.rank);
    expect(body.attempt.ranked.tx).toBe("memory:1");

    const entry = ledger.entriesOf(42n)[0]!;
    expect(entry.uri).toBe(`http://bench.test/attempts/${id}`);
    expect(entry.hash).toBe(recordHash(ranked.attempts.get(id)!));

    const rating = await (await callRanked("GET", `/rating/${ID}`)).json() as { rating: number; ranked: string[]; source: string };
    expect(rating).toMatchObject({ rating: 3, ranked: ["blackbox"], source: "erc-8004" });
  });

  test("an open run is refused before it is charged", async () => {
    const { id } = await (await callRanked("POST", "/attempts", {}, as({ "x-agent-id": ID }))).json() as { id: string };
    const r = await callRanked("POST", `/attempts/${id}/rank`, {}, asAgent);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ charged: false });
    expect(money.spentBy(AGENT)).toBe(0n);
  });

  test("a server with no registry cannot rank at all, and says so", async () => {
    const id = await solved();
    const { reputation: _off, ...without } = ranked;
    const r = await handle(new Request(`http://bench.test/attempts/${id}/rank`, { method: "POST", headers: asAgent }), without);
    expect(r.status).toBe(404);
  });

  test("a gated bounty lets in an identity whose ranked record meets the bar, and no one borrowing it", async () => {
    const posted = await (await callRanked("POST", "/bounties", {
      title: "t", statement: "s", amount: "1.00", deadline: Date.now() + 3 * 3600_000,
      minRating: 3, checker: { kind: "equals", value: 7 },
    }, { "x-agent": "0xposter" })).json() as { id: string };

    // No record yet: refused for free.
    const cold = await callRanked("POST", `/bounties/${posted.id}/solve`, { answer: 7 }, as({ "x-agent-id": ID }));
    expect(cold.status).toBe(403);
    expect(await cold.json()).toMatchObject({ rating: 0, needs: 3, charged: false });

    // Solved but not ranked: still nothing, because the gate reads the ledger and not our database.
    const id = await solved();
    const unranked = await callRanked("POST", `/bounties/${posted.id}/solve`, { answer: 7 }, as({ "x-agent-id": ID }));
    expect(await unranked.json()).toMatchObject({ rating: 0 });

    await callRanked("POST", `/attempts/${id}/rank`, {}, as({ "x-agent-id": ID }));

    // Someone else claiming id 42: the free check passes on the record, the paid one refuses.
    money.grant("agent:borrower", usdc("5"));
    const borrowed = await callRanked("POST", `/bounties/${posted.id}/solve`, { answer: 7 },
      { "x-agent": "agent:borrower", "x-agent-id": ID });
    expect(borrowed.status).toBe(403);
    expect(await borrowed.json()).toMatchObject({ charged: true });

    // The owner of id 42 gets in, and wins.
    const won = await callRanked("POST", `/bounties/${posted.id}/solve`, { answer: 7 }, as({ "x-agent-id": ID }));
    expect(await won.json()).toMatchObject({ solved: true, solver: AGENT });
  });

  test("a server with no registry refuses to post a bounty that requires a record", async () => {
    const { reputation: _off, ...without } = ranked;
    const r = await handle(new Request("http://bench.test/bounties", {
      method: "POST", headers: { "content-type": "application/json", "x-agent": "0xposter" },
      body: JSON.stringify({ title: "t", statement: "s", amount: "1.00", deadline: Date.now() + 3 * 3600_000,
                             minRating: 1, checker: { kind: "equals", value: 7 } }),
    }), without);
    expect(r.status).toBe(409);
  });
});

/**
 * Bodies that are not objects. Found by the functional test on testnet: Codebreaker's documented
 * probe is a bare string, and the router tested `"question" in body` on it, which throws, so every
 * Codebreaker probe sent the documented way was a 500. Unit tests had called the lifecycle directly.
 */
describe("a body that is not an object", () => {
  test("a bare string is a question, and Codebreaker answers it", async () => {
    const { id } = await (await call("POST", "/attempts", { problem: "codebreaker" }, asAgent)).json() as { id: string };
    const r = await call("POST", `/attempts/${id}/ask`, "AABB", asAgent);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ answer: { guess: "AABB" } });
  });

  test("a bare array is a question too", async () => {
    const { id } = await (await call("POST", "/attempts", { problem: "ranking" }, asAgent)).json() as { id: string };
    expect((await call("POST", `/attempts/${id}/ask`, ["A", "B"], asAgent)).status).toBe(200);
  });

  test("an answer of 0 or false is still an answer, not a missing body", async () => {
    const { id } = await (await call("POST", "/attempts", { problem: "liar" }, asAgent)).json() as { id: string };
    const r = await call("POST", `/attempts/${id}/submit`, { answer: 0 }, asAgent);
    expect(r.status).toBe(200);
  });

  test("anything but an object where one is required is a 400, never a 500", async () => {
    const { id } = await (await call("POST", "/attempts", { problem: "toll" }, asAgent)).json() as { id: string };
    const withBounties: Deps = { ...deps, bounties: new Bounties() };
    for (const bad of ["EESS", 7, [1, 2], null, true]) {
      expect((await call("POST", `/attempts/${id}/submit`, bad, asAgent)).status).toBe(400);
      const posted = await handle(new Request("http://bench.test/bounties", {
        method: "POST", headers: { "content-type": "application/json", ...asAgent }, body: JSON.stringify(bad) }), withBounties);
      expect(posted.status).toBe(400);
    }
    const unparsable = await handle(new Request(`http://bench.test/attempts/${id}/ask`, {
      method: "POST", headers: { "content-type": "application/json", ...asAgent }, body: "{not json" }), deps);
    expect(unparsable.status).toBe(400);
  });
});

/**
 * The arc-mandate connector's `buy` tool sends a method and a URL, and nothing else: no body, no
 * headers. It is the only real client there is, so every step of a run has to work that way too.
 * Its own instructions tell an agent to give its id as `?agent=`.
 */
describe("a run driven entirely from the URL, the way the connector calls", () => {
  const post = (path: string) => handle(new Request(`http://bench.test${path}`, { method: "POST" }), deps);

  test("start, probe, submit: Toll, with no body and no headers anywhere", async () => {
    money.grant("anonymous", usdc("1"));
    const started = await (await post("/attempts?problem=toll&budget=0.50")).json() as { id: string; problem: string; budget: string };
    expect(started).toMatchObject({ problem: "toll", budget: "0.500000" });
    const map = await (await post(`/attempts/${started.id}/ask?q=${encodeURIComponent('{"map":true}')}`)).json() as { answer: { map: Walls[][] } };
    const route = shortestRoute(map.answer.map).join("");
    const r = await (await post(`/attempts/${started.id}/submit?answer=${route}`)).json() as { solved: boolean };
    expect(r.solved).toBe(true);
  });

  test("an answer in the URL is read as JSON when it is JSON, and as text when it is not", async () => {
    money.grant("anonymous", usdc("1"));
    const { id } = await (await post("/attempts?problem=codebreaker")).json() as { id: string };
    const guess = await (await post(`/attempts/${id}/ask?q=AABB`)).json() as { answer: { guess: string } };
    expect(guess.answer.guess).toBe("AABB");
    const ranking = await (await post("/attempts?problem=ranking")).json() as { id: string };
    const compared = await post(`/attempts/${ranking.id}/ask?q=${encodeURIComponent('["A","B"]')}`);
    expect(compared.status).toBe(200);
  });

  test("?agent= claims an ERC-8004 id, as the connector's instructions say", async () => {
    const claims: bigint[] = [];
    const verify = async (id: bigint) => { claims.push(id); return true; };
    const withIds: Deps = { ...deps, attempts: new Attempts(money, undefined, verify) };
    money.grant("anonymous", usdc("1"));
    const { id } = await (await handle(new Request("http://bench.test/attempts?problem=toll&agent=894767", { method: "POST" }), withIds)).json() as { id: string };
    await handle(new Request(`http://bench.test/attempts/${id}/ask?q=${encodeURIComponent('{"map":true}')}`, { method: "POST" }), withIds);
    expect(claims).toEqual([894767n]);
    expect(withIds.attempts.get(id)!.identity).toBe("894767");
  });

  test("a seed in the URL is refused like a seed in the body", async () => {
    expect((await post("/attempts?problem=toll&seed=1")).status).toBe(400);
  });

  test("with neither a body nor the parameter, it says what it needs", async () => {
    const { id } = await (await post("/attempts?problem=toll")).json() as { id: string };
    expect((await post(`/attempts/${id}/ask`)).status).toBe(400);
    expect((await post(`/attempts/${id}/submit`)).status).toBe(400);
  });
});

/**
 * The response to a submission describes the run after it, not before. Found playing Ranking through
 * the connector on testnet: "solved": true, with a score beside it saying solved false and still
 * open. SQLite hands back a copy of a run, so the one read before grading goes stale; the in-memory
 * store hands back the same object, which is why no test saw it. This one uses SQLite.
 */
describe("responses describe the run as it now is", () => {
  test("a solving submission carries a score that says solved", async () => {
    const onDisk: Deps = { ...deps, attempts: new Attempts(money, new SqliteStore(":memory:")) };
    const started = await (await handle(new Request("http://bench.test/attempts", {
      method: "POST", headers: { "content-type": "application/json", ...asAgent }, body: "{}" }), onDisk)).json() as { id: string };
    const seed = onDisk.attempts.get(started.id)!.seed;
    const r = await (await handle(new Request(`http://bench.test/attempts/${started.id}/submit`, {
      method: "POST", headers: { "content-type": "application/json", ...asAgent },
      body: JSON.stringify({ answer: boardFrom(seed).atoms }) }), onDisk)).json() as
      { solved: boolean; score: { solved: boolean; endedBy: string; submissions: number; seed: string | null } };
    expect(r.solved).toBe(true);
    expect(r.score).toMatchObject({ solved: true, endedBy: "solved", submissions: 1 });
    expect(r.score.seed).toBe(seed);
  });
});

describe("who an agent is, consistently", () => {
  const PAYER = "0xabc0000000000000000000000000000000000001";

  const runWithPayer = async () => {
    const { id } = await (await call("POST", "/attempts", {}, asAgent)).json() as { id: string };
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

  /**
   * A name in a header finds nothing, on either. It used to find the run, and that is what let
   * three free solves under any name qualify that name for a bounty: `FINDINGS.md` 26.
   */
  test("the label alone finds nothing, on both, because a name is a claim", async () => {
    await runWithPayer();
    const agents = await (await call("GET", `/agents/${AGENT}`)).json() as { attempts: number };
    const rating = await (await call("GET", `/rating/${AGENT}`)).json() as { attempted: number };
    expect(agents.attempts).toBe(0);
    expect(rating.attempted).toBe(0);
  });

  test("an address is the same account whatever its case", async () => {
    await runWithPayer();
    const rating = await (await call("GET", `/rating/${PAYER.toUpperCase().replace("0X", "0x")}`)).json() as { attempted: number };
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

/**
 * What an operator needs, which nothing here had because nothing here had ever been deployed.
 */
describe("health", () => {
  test("it answers, and says what this process is configured for", async () => {
    const r = await call("GET", "/health");
    expect(r.status).toBe(200);
    const body = await r.json() as { ok: boolean; network: string; problems: number };
    expect(body.ok).toBe(true);
    expect(body.network).toBe("testnet");
    expect(body.problems).toBeGreaterThan(0);
  });

  test("a deploy pointed at the wrong network is visible without reading logs", async () => {
    const body = await (await call("GET", "/health")).json() as { chain: string };
    expect(body.chain).toBe("eip155:5042002");
  });

  test("it needs no agent and no payment", async () => {
    expect((await call("GET", "/health")).status).toBe(200);
  });

  /** A platform polls this every few seconds; it must not reach a chain or a facilitator. */
  test("it is fast enough to poll", async () => {
    const started = performance.now();
    for (let i = 0; i < 20; i++) await call("GET", "/health");
    expect(performance.now() - started).toBeLessThan(200);
  });

  test("a store it cannot read is reported rather than thrown", async () => {
    const broken = { ...deps, attempts: { all() { throw new Error("disk gone"); } } } as unknown as Deps;
    const r = await handle(new Request("http://bench.test/health"), broken);
    expect(r.status).toBe(503);
    expect((await r.json() as { ok: boolean }).ok).toBe(false);
  });
});
