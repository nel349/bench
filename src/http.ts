import { Attempts, recordHash, score, wireAttempt, wireScore, type Attempt, type IdentityVerifier } from "./attempt.ts";
import type { AgentId, Payments, Quote } from "./payments.ts";
import { PRICE } from "./pricing.ts";
import { format, usdc, type Usdc } from "./money.ts";
import { allProblems, problemOf } from "./problems/problem.ts";
import "./problems/blackbox-problem.ts";
import "./problems/zendo.ts";
import "./problems/toll.ts";
import "./problems/bisect.ts";
import "./problems/codebreaker.ts";
import "./problems/ranking.ts";
import "./problems/liar.ts";
import { drawSeed, fingerprint } from "./problems/seed.ts";
import { caip2, chainOf, contractsOf, network, type Network } from "./arc/chain.ts";
import { Serial } from "./serialize.ts";
import { parseAgentId } from "./arc/identity.ts";
import { b64, MIN_VALIDITY_SECONDS, PAYMENT_HEADERS, SETTLEMENT_HEADER, X402_VERSION } from "./arc/facilitator.ts";
import { wireBounty, type Bounties } from "./bounties.ts";
import type { AllowanceReader } from "./arc/allowance.ts";
import type { Arbiter } from "./arc/arbiter.ts";
import type { Backing, EscrowReader } from "./arc/escrow.ts";
import type { FundsReader } from "./arc/funds.ts";
import { paidBy, rate, weigh } from "./rating.ts";
import type { Reputation } from "./reputation.ts";
import { PATHS, FEED_LIMIT } from "./paths.ts";
import type { AgentRecordWire, ChainRatingWire, ProblemDetailWire, ProblemWire, SettingsWire } from "./wire.ts";

/**
 * The HTTP surface, as one function from a request to a response.
 *
 * No socket, no port, no framework. `handle` is called directly by the tests, which is what keeps
 * the default test lane runnable with nothing configured — and it means the routing and the rules
 * are exercised together rather than the rules being tested and the routing hoped about.
 *
 * Three answers matter and they are deliberately different HTTP shapes:
 *
 *   - **402** — you have not paid. Sign the quote and ask again. Nothing happened.
 *   - **200 with `refused`** — you paid your way to the limit and it stopped you. The run is over
 *     and this is a *result*, not an error, so it is not a 4xx. This is the product working.
 *   - **200** — it worked.
 */

export interface Deps {
  readonly attempts: Attempts;
  readonly payments: Payments;
  readonly net: Network;
  /** Sends the payout when a bounty is won. Absent where no key is configured to sign one. */
  readonly arbiter?: Arbiter;
  /** Reads what the chain says about a bounty's money. Absent where no escrow is deployed. */
  readonly escrow?: EscrowReader;
  /** Reads what an agent holds, for the funding page. */
  readonly funds?: FundsReader;
  /** Reads the session-key plugin, where one is deployed. Absent on a network without it. */
  readonly allowances?: AllowanceReader;
  /**
   * Bounties, where a server runs them. Optional rather than always-on: a gym with no escrow behind
   * it should answer 404 on these rather than take a posting it cannot pay out.
   */
  readonly bounties?: Bounties;
  /**
   * Where ranked runs are written and ratings read back: ERC-8004 on Arc. Absent where there is no
   * registry, and then nothing can be ranked and no bounty can require a record, because nothing
   * here could check one.
   */
  readonly reputation?: Reputation;
  /** Whether an ERC-8004 id belongs to the address that paid. Absent where identities are off. */
  readonly verifyIdentity?: IdentityVerifier;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

const fail = (status: number, error: string): Response => json({ error }, status);

/**
 * The payment came, and did not work. Still a 402: the request is unpaid and paying it correctly is
 * what fixes it, so the quote goes back out with the reason. The run is untouched — see `BadPayment`.
 */
const paymentRefused = (reason: string, quote: Quote, path: string, net: Network): Response =>
  json({
    x402Version: 1,
    error: `that payment was not accepted: ${reason}`,
    accepts: [accepts(quote, path, net)],
  }, 402);

/**
 * Our end broke. Deliberately **not** a 402, because the caller's money is fine and telling them
 * otherwise sends them to debug a wallet that has nothing wrong with it.
 */
const unavailable = (reason: string): Response =>
  json({ error: reason, retry: true }, 503, { "Retry-After": "5" });

/**
 * One entry of an x402 `accepts` list: what to pay, where, and on which chain.
 *
 * `amount`, not `maxAmountRequired`. The buyers on Arc read `amount`, and the earlier spelling —
 * taken from the specification rather than from anything that pays — made every quote here
 * unpayable by a real agent while looking perfectly correct.
 *
 * `extra` carries the EIP-712 domain the authorisation is signed against, and without it there is
 * nothing for a buyer to sign.
 */
const accepts = (q: Quote, resource: string, net: Network) => ({
  scheme: q.scheme,
  network: q.chain,
  resource,
  amount: q.amount.toString(),
  asset: q.token,
  payTo: q.payTo,
  maxTimeoutSeconds: q.maxTimeoutSeconds ?? MIN_VALIDITY_SECONDS,
  /**
   * The signing domain, filled in from the network when the payments implementation did not supply
   * one — which is the in-memory allowance used in development.
   *
   * Without it a dev 402 is unparseable by a real agent: there is no domain to sign against, so the
   * quote cannot be acted on at all. Dev mode not verifying a signature is the point of dev mode;
   * dev mode emitting a quote nobody could sign makes rehearsing the real flow impossible, and
   * would have hidden every one of the protocol bugs found here.
   */
  extra: q.extra ?? {
    name: "GatewayWalletBatched",
    version: "1",
    verifyingContract: contractsOf(net).gatewayWallet,
  },
});

/**
 * The x402 body.
 *
 * `resource` appears at the top level as well as inside each entry, because that is where a buyer
 * reads it from when building its payment, and a payment without it is rejected by Circle before
 * it is looked at.
 */
function paymentRequired(q: Quote, resource: string, net: Network): Response {
  return json({
    x402Version: X402_VERSION,
    error: "payment required",
    resource: describes(resource),
    accepts: [accepts(q, resource, net)],
  }, 402);
}

/**
 * What is being bought, in the shape the facilitator requires.
 *
 * A bare URL is refused, and all three fields are mandatory. The URL is left relative because the
 * hostname is not ours to assume behind a proxy; a buyer resolves it against the host it asked.
 */
const describes = (path: string) => ({
  url: path,
  description: path.endsWith("/submit") ? "A graded submission" : "One probe",
  mimeType: "application/json",
});

/**
 * Who is asking, if they said.
 *
 * **Optional, and it used to be mandatory.** Requiring it contradicted the rule this API is built
 * on: identity comes from payment, the payer is proven, and the header is a label. Yet it was
 * demanded on a *free* call, so an agent had to name itself before paying for anything and the name
 * it invented was then not the identity it ended up with.
 *
 * It also made the product unusable. The only real client that exists — the mandate's connector —
 * does not send it, so every agent using it was refused at the first request, before payment was
 * involved. The seller and the buyer had never been pointed at each other.
 *
 * A run is anonymous until its first payment binds it to an address. Absent a header, a run is
 * labelled by the payer once there is one, and until then by nothing.
 */
function agentOf(req: Request): AgentId | null {
  const id = req.headers.get("x-agent");
  return id && id.trim().length > 0 ? id.trim() : null;
}

/** The label a run carries before anything has been paid. Replaced by the payer at first payment. */
const ANONYMOUS = "anonymous";

/**
 * The payment, from whichever header it arrived in. See `PAYMENT_HEADERS`.
 */
const proofOf = (req: Request): string | null => {
  for (const name of PAYMENT_HEADERS) {
    const value = req.headers.get(name);
    if (value && value.trim().length > 0) return value.trim();
  }
  return null;
};

/**
 * The settlement receipt, on every answer to a request whose payment was taken.
 *
 * A buyer decides whether it paid from this rather than from the status code, so a 200 that took
 * money and said so only in its body leaves the buyer's ledger wrong — and it is the buyer's owner
 * who then cannot reconcile it.
 */
const receipted = (res: Response, charge: { payer?: string; settlement?: string }, net: Network): Response => {
  res.headers.set(SETTLEMENT_HEADER, b64.encode({
    success: true,
    transaction: charge.settlement ?? null,
    network: caip2(net),
    payer: charge.payer ?? null,
  }));
  return res;
};

/**
 * The ERC-8004 id an agent says is its own.
 *
 * A claim, and treated as one: it is recorded on the run and only becomes an identity if the
 * registry says the address that paid is the wallet behind it. Malformed is silently no claim rather
 * than a 400 — an agent that sends a junk id still gets to run, it simply runs unidentified.
 */
const claimedIdOf = (req: Request): bigint | null => parseAgentId(req.headers.get("x-agent-id"));

const SCORING = "Ranked by cost to solve. Ties break on fewest probes.";

/** What `bodyOf` returns when there is no body, or it is not JSON. Distinct from any value JSON can hold. */
const NO_BODY: unique symbol = Symbol("no body");

/**
 * The request's JSON, whatever it is: an object, an array, a string, a number, even `false`.
 *
 * Every route used to read the body with `.catch(() => null)` and then test `"answer" in body`. A
 * bare string is valid JSON, and `in` on a string throws, so Codebreaker's documented probe, `"ABCD"`,
 * was a 500 every time, and a bare `0` was taken for no body at all. The functional test on testnet
 * found it; the unit tests had called the lifecycle directly and never sent a string.
 */
async function bodyOf(req: Request): Promise<unknown> {
  try { return await req.json(); } catch { return NO_BODY; }
}
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** What an unqualified agent is told to do, in one place. */
const HOW_TO_QUALIFY =
  "rank solved runs on different problems: easy counts 1, medium 2, hard 3. " +
  "Send X-Agent-Id with your ERC-8004 id, from the address that id names as its wallet";

/**
 * The weighted rating of an ERC-8004 id, read from where ranked runs are written.
 *
 * No id, or no registry, is a rating of nothing rather than an error: an agent that has not claimed
 * an identity has no record to read. A registry that cannot be read throws, and the caller says so,
 * because refusing someone for a record we failed to read would be our fault reported as theirs.
 */
async function ratingOf(deps: Deps, agentId: bigint | null): Promise<number> {
  if (agentId === null || !deps.reputation) return 0;
  return weigh(await deps.reputation.ranked(agentId));
}

/** The harness's seed when none is asked for, so its examples are the same for everyone. */
const PRACTICE_SEED = "1";

/** Whether this request is a person navigating, rather than a client fetching. */
const wantsHtml = (req: Request): boolean =>
  (req.headers.get("accept") ?? "").includes("text/html");

/** Where `bun run build` puts the browser app. */
const APP_DIR = new URL("../web/dist/", import.meta.url);

/**
 * A file from the built app, or the page itself for anything that is not one.
 *
 * Paths are resolved against the build directory and checked to still be inside it, because a
 * request for `/../.env` is a request somebody makes on purpose.
 */
async function servedFile(path: string, navigating: boolean): Promise<Response | null> {
  const wanted = new URL(`.${path}`, APP_DIR);
  if (!wanted.pathname.startsWith(APP_DIR.pathname)) return null;

  const asset = Bun.file(wanted);
  if (path !== "/" && await asset.exists()) {
    return new Response(asset, {
      headers: {
        "content-type": asset.type,
        // Vite fingerprints assets, so they can be cached hard. The page itself cannot.
        ...(path.startsWith("/assets/") ? { "cache-control": "public, max-age=31536000, immutable" } : {}),
      },
    });
  }

  /**
   * A missing asset is a 404, never the page.
   *
   * Falling through would answer a request for a script with HTML, and the browser reports that as
   * a MIME type error somewhere else entirely — a deploy that dropped one file would look like a
   * bug in the application.
   */
  if (path.startsWith("/assets/")) return null;

  /**
   * Only a browser gets the page.
   *
   * A deep link must survive a reload, so an unknown path renders the app and lets it decide. But
   * an agent that typos an API path is asking for JSON, and answering it with HTML turns a typo
   * into a parse error somewhere unrelated — it gets the 404 it asked for.
   */
  if (!navigating) return null;

  const index = Bun.file(new URL("index.html", APP_DIR));
  if (!await index.exists()) return null;
  return new Response(index, { headers: { "content-type": "text/html; charset=utf-8" } });
}

/**
 * Moves the money for a bounty that has been won.
 *
 * Returns `null` when there is nothing to try — no arbiter configured, or no escrow behind this
 * bounty — which is a different thing from a payout that was attempted and failed, and reads
 * differently in the response.
 */
async function payOut(
  deps: Deps, id: string,
): Promise<{ ok: true; tx: string } | { ok: false; because: string } | null> {
  /**
   * One payout attempt at a time, per bounty.
   *
   * The retry route is open to anyone on purpose — it can only pay the address already recorded as
   * the winner — but every call used to send a transaction, and the contract reverts a duplicate
   * rather than refusing cheaply. So a stranger could spend our gas at will by repeating a request
   * designed to be safe to repeat. Concurrent calls now collapse into one attempt, and the second
   * finds the work already done.
   */
  return payouts.run(`bounty:${id}`, async () => {
    const bounty = deps.bounties?.get(id);
    if (!deps.arbiter || !bounty?.escrowId || !bounty.solvedBy || bounty.awardTx) return null;

    /**
     * Ask the chain before spending gas on it.
     *
     * An escrow already settled cannot be awarded again, and finding that out by sending a
     * transaction that reverts costs us and nobody else. A read costs nothing.
     */
    if (deps.escrow) {
      const state = await deps.escrow.read(bounty.escrowId);
      if (state.ok && state.backing.settled) {
        return { ok: false, because: "that escrow has already been settled on chain" };
      }
    }

    const out = await deps.arbiter.award(bounty.escrowId, bounty.solvedBy);
    if (out.ok) deps.bounties!.paid(id, out.tx);
    return out;
  });
}

/** Keyed by bounty, so two payouts for different bounties never wait for each other. */
const payouts = new Serial();

/**
 * Nothing escapes as a bare 500.
 *
 * A route that throws used to become an empty 500 with no body, which is the least useful thing an
 * API can do — it tells a caller that something went wrong and nothing about what or whose fault it
 * was. Found by firing a malformed probe at an attempt that had already been solved: the answer was
 * a 500 where it should have been "that run is over".
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  try {
    return await route(req, deps);
  } catch (cause) {
    /**
     * Logged, never returned.
     *
     * `detail` used to carry the thrown message straight back to the caller, which undoes the care
     * taken everywhere else: a viem error names the RPC endpoint — and an endpoint can carry a key
     * — while a SQLite error names a path on our disk. None of it helps whoever asked, and the
     * parts that would help them are already the 4xx answers above.
     */
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[bench] ${req.method} ${new URL(req.url).pathname}: ${message}`);
    return json({ error: "something went wrong here, and it is not your request" }, 500);
  }
}

async function route(req: Request, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const seg = path.split("/").filter(Boolean);
  const prices = { ask: format(PRICE.ask), submit: format(PRICE.submit), rank: format(PRICE.rank) };

  /**
   * The index, for a client.
   *
   * A browser asking for `text/html` never reaches here: it falls through to the built application,
   * which fetches this same JSON like any other caller. One URL and two audiences, but only one of
   * them renders anything — which is the point of deleting the server-rendered page.
   */
  if (req.method === "GET" && path === PATHS.index && !wantsHtml(req)) {
    return json({
      service: "bench", network: deps.net, chain: caip2(deps.net),
      problems: allProblems().map((p) => p.id),
    });
  }

  /**
   * Whether this process can serve.
   *
   * Free, unauthenticated and deliberately dull: a platform polls it every few seconds and it must
   * not touch a chain, a facilitator or anything that can be slow. It answers for *this* process —
   * that the store opens and the problems registered — and says what it is configured for, so a
   * deploy that came up pointing at the wrong network is visible without reading logs.
   */
  if (req.method === "GET" && path === PATHS.health) {
    try {
      const runs = deps.attempts.all().length;
      return json({
        ok: true, network: deps.net, chain: caip2(deps.net), problems: allProblems().length, runs,
        payments: deps.payments.constructor.name === "ArcPayments" ? "x402" : "in-memory",
        bounties: deps.bounties ? "on" : "off",
        escrowChecked: deps.escrow ? true : false,
        payouts: deps.arbiter ? "on" : "off",
      });
    } catch (cause) {
      // A store that cannot be read is exactly what this endpoint exists to report.
      return json({ ok: false, because: cause instanceof Error ? cause.message : "unreadable" }, 503);
    }
  }

  /** What an agent holds. Polled by the page while a transfer settles. */
  if (req.method === "GET" && seg[0] === "funds" && seg[1]) {
    if (!deps.funds) return fail(404, `this server cannot read balances on ${deps.net}`);
    const funds = await deps.funds.read(seg[1]);
    if (!funds) return fail(404, "that is not an address on this network");
    return json({
      agent: funds.agent, wallet: format(funds.wallet), deposit: format(funds.deposit),
      ready: funds.ready, probes: funds.probes,
    });
  }

  /**
   * What the browser app needs to know, asked once.
   *
   * The addresses live here and not in the app, because this process knows which network it is
   * serving and a copy in a bundle is a copy that can drift — which is how a page ends up sending
   * money to a testnet address on mainnet.
   */
  if (req.method === "GET" && path === PATHS.settings) {
    const c = contractsOf(deps.net);
    const settings: SettingsWire = {
      chainId: chainOf(deps.net).id,
      usdc: c.usdc,
      gateway: c.gatewayWallet,
      probePrice: format(PRICE.ask),
      reputation: deps.reputation ? c.erc8004?.reputation ?? null : null,
    };
    return json(settings);
  }

  if (req.method === "GET" && path === PATHS.problems) {
    return json(allProblems().map((p): ProblemWire =>
      ({ id: p.id, title: p.title, category: p.category, level: p.level, par: p.par, prices })));
  }

  if (req.method === "GET" && seg[0] === "problems" && seg[1]) {
    const problem = problemOf(seg[1]);
    if (!problem) return fail(404, `no problem ${seg[1]}`);

    if (seg.length === 2) {
      const detail: ProblemDetailWire = {
        id: problem.id, title: problem.title, category: problem.category,
        level: problem.level, par: problem.par,
        statement: problem.statement, scoring: SCORING, prices,
      };
      return json(detail);
    }

    /**
     * The harness: everything needed to rebuild an instance and replay a run, offline and free.
     *
     * Any text is a seed here, which makes this the place to practise on an instance of your
     * choosing, and the place to check a finished run once its seed has been revealed.
     */
    if (seg[2] === "harness") {
      const seed = url.searchParams.get("seed") ?? PRACTICE_SEED;
      return json({ problem: problem.id, seed, fingerprint: fingerprint(seed), ...(problem.harness(seed) as object) });
    }
  }

  if (req.method === "POST" && path === PATHS.attempts) {
    const agent = agentOf(req) ?? ANONYMOUS;
    const read = await bodyOf(req);
    // No body is allowed and means the defaults; a body that is not an object is a mistake.
    if (read !== NO_BODY && !isRecord(read)) return fail(400, "starting a run takes a JSON object, or no body");
    const body = (read === NO_BODY ? {} : read) as { seed?: unknown; problem?: string; budget?: unknown };
    const problem = body.problem ?? "blackbox";

    /**
     * The gym draws the seed, always, and keeps it until the run is over.
     *
     * An agent that chose its seed, or was shown it, could rebuild the instance from the public
     * generator and submit the answer for nothing. Refused rather than ignored, so a client written
     * against the old contract finds out instead of silently playing a different instance.
     */
    if (body.seed !== undefined) {
      return fail(400, `a run's seed is drawn by the gym and revealed when the run ends. ` +
        `To practise on a seed of your choosing, use ${PATHS.problems}/${problem}/harness?seed=…, which is free`);
    }
    const seed = drawSeed();

    /**
     * A cap the agent sets on itself, on top of whatever its allowance permits.
     *
     * It was enforceable from the first day and unreachable until now: `Attempt.budget` was stored,
     * returned and checked on every spend, but nothing ever parsed it out of a request, so every run
     * started uncapped. Found by setting one and watching it be ignored.
     *
     * A decimal string, never a number, for the same reason every other amount here is.
     */
    let budget: Usdc | null = null;
    if (body.budget !== undefined && body.budget !== null) {
      if (typeof body.budget !== "string") {
        return fail(400, "budget must be a decimal string, like \"0.50\" — not a number");
      }
      try {
        budget = usdc(body.budget);
      } catch {
        return fail(400, `budget is not an amount: ${body.budget}`);
      }
      if (budget <= 0n) return fail(400, "a budget of zero would refuse the first question");
    }

    const started = deps.attempts.start(agent, problem, seed, budget, claimedIdOf(req));
    if (!started) return fail(404, `no problem ${problem}`);
    return json(wireAttempt(started), 201);
  }

  if (seg[0] === "attempts" && seg[1]) {
    const attempt = deps.attempts.get(seg[1]);
    if (!attempt) return fail(404, `no attempt ${seg[1]}`);

    if (req.method === "GET" && seg.length === 2) return json(wireAttempt(attempt));

    /**
     * Rank a solved run: $0.25 to have it written to the agent's ERC-8004 identity.
     *
     * Before the finished-run guard below, because a run has to be finished, and solved, to be
     * ranked. Everything that would make ranking pointless is refused for free; a record already on
     * chain is returned for free; a record paid for and not yet written is retried for free.
     */
    if (req.method === "POST" && seg[2] === "rank") {
      if (!deps.reputation) {
        return fail(404, `no reputation registry on ${deps.net}, so a run cannot be ranked here`);
      }
      const reputation = deps.reputation;
      const out = await deps.attempts.rank(attempt.id, (a, agentId) => reputation.write({
        agentId, problem: a.problem, cost: a.spend,
        endpoint: url.origin, uri: `${url.origin}${PATHS.attempts}/${a.id}`, hash: recordHash(a),
      }), proofOf(req));
      if ("notRankable" in out) return json({ error: out.notRankable, charged: false }, 409);
      if ("needsPayment" in out) return paymentRequired(out.needsPayment, path, deps.net);
      if ("badPayment" in out) return paymentRefused(out.badPayment, out.quote, path, deps.net);
      if ("unavailable" in out) return unavailable(out.unavailable);
      if ("refused" in out) {
        return json({ refused: out.refused, wanted: format(out.wanted), remaining: format(out.remaining) });
      }
      const ranked = deps.attempts.get(attempt.id)!;
      if ("unwritten" in out) {
        return receipted(json({ ranked: false, because: out.unwritten, paid: format(out.paid),
                               attempt: wireAttempt(ranked) }, 503), out, deps.net);
      }
      return receipted(json({ ranked: true, tx: out.ranked, paid: format(out.paid),
                             scribe: reputation.scribe, attempt: wireAttempt(ranked) }), out, deps.net);
    }

    /**
     * A finished run is finished.
     *
     * 409 rather than 400, because the request is well formed and the *state* is what refuses it —
     * and rather than an exception, because "this run ended" is an ordinary thing to tell a caller,
     * not an internal failure.
     */
    if (req.method === "POST" && attempt.outcome !== "open") {
      return json({
        error: `this attempt is ${attempt.outcome}`,
        attempt: wireAttempt(attempt),
      }, 409);
    }

    if (req.method === "POST" && seg[2] === "ask") {
      const body = await bodyOf(req);
      if (body === NO_BODY) return fail(400, "ask takes a JSON body");
      // A bare body is the question, so `{"side":"left","index":0}` and `"ABCD"` work as well as
      // `{"question":...}`.
      const question = isRecord(body) && "question" in body ? body.question : body;
      const out = await deps.attempts.ask(attempt.id, question, proofOf(req));
      if ("malformed" in out) {
        const p = problemOf(attempt.problem);
        return fail(400, `that is not a question this problem takes. See ${p ? `/problems/${p.id}/harness` : "the harness"}`);
      }
      if ("needsPayment" in out) return paymentRequired(out.needsPayment, path, deps.net);
      if ("badPayment" in out) return paymentRefused(out.badPayment, out.quote, path, deps.net);
      if ("unavailable" in out) return unavailable(out.unavailable);
      if ("refused" in out) {
        return json({ refused: out.refused, wanted: format(out.wanted), remaining: format(out.remaining),
                      attempt: wireAttempt(attempt) });
      }
      return receipted(json({ answer: out.answer, paid: format(out.paid), spend: format(out.spend) }),
                       out, deps.net);
    }

    if (req.method === "POST" && seg[2] === "submit") {
      const body = await bodyOf(req);
      if (!isRecord(body) || !("answer" in body || "guess" in body)) {
        return fail(400, 'submit takes a JSON object with an answer: {"answer": ...}');
      }
      const answer = "answer" in body ? body["answer"] : body["guess"];
      const out = await deps.attempts.submit(attempt.id, answer, proofOf(req));
      if ("needsPayment" in out) return paymentRequired(out.needsPayment, path, deps.net);
      if ("badPayment" in out) return paymentRefused(out.badPayment, out.quote, path, deps.net);
      if ("unavailable" in out) return unavailable(out.unavailable);
      if ("refused" in out) {
        return json({ refused: out.refused, wanted: format(out.wanted), remaining: format(out.remaining),
                      attempt: wireAttempt(attempt) });
      }
      return receipted(json({ solved: out.solved, paid: format(out.paid), spend: format(out.spend),
                             submissions: out.submissions,
                             score: out.solved ? wireScore(score(attempt)) : null }), out, deps.net);
    }
  }

  /**
   * An agent's record: the runs its money paid for, the same rule `rate` uses.
   *
   * They disagreed once: this filtered on the header alone, so `/rating/0xabc…` returned a record
   * and `/agents/0xabc…` returned nothing for the same agent. Both now go through `paidBy`.
   */
  if (req.method === "GET" && seg[0] === "agents" && seg[1]) {
    const mine = paidBy(deps.attempts.all(), seg[1]);
    const record: AgentRecordWire = {
      agent: seg[1],
      spend: format(deps.payments.spentBy(seg[1]!)),
      attempts: mine.length,
      solved: mine.filter((a) => a.outcome === "solved").length,
      refused: mine.filter((a) => a.outcome === "refused").length,
      runs: mine.map((a) => wireScore(score(a))),
    };
    return json(record);
  }

  /**
   * Recent runs across every problem, newest first — **including the refused ones**.
   *
   * A leaderboard shows who won. This shows what it cost and who ran out, which is the part that
   * makes the number mean anything. Hiding refusals would make the gym look easier than it is.
   */
  if (req.method === "GET" && path === PATHS.feed) {
    // Paid runs only: starting one is free, so a feed of every run could be filled by anyone for
    // nothing. A run nobody paid for is nobody's, here as on the boards.
    const recent = deps.attempts.all()
      .filter((a) => a.payer !== null)
      .sort((x, y) => y.startedAt - x.startedAt)
      .slice(0, FEED_LIMIT);
    return json(recent.map((a) => ({ ...wireScore(score(a)), startedAt: a.startedAt })));
  }

  /**
   * Bounties. Posting is free; attempting one costs a graded submission, as it does anywhere else.
   *
   * The answer key never appears in any of these responses. `wireBounty` is the only way a bounty
   * reaches a body, and it has no field for one.
   */
  if (seg[0] === "bounties" && !deps.bounties) return fail(404, "bounties are not enabled on this server");

  if (req.method === "GET" && path === PATHS.bounties) {
    return json(deps.bounties!.all().map((b) => wireBounty(b)));
  }

  if (req.method === "POST" && path === PATHS.bounties) {
    const agent = agentOf(req) ?? ANONYMOUS;
    const body = await bodyOf(req);
    if (!isRecord(body)) return fail(400, "posting a bounty takes a JSON object");

    /**
     * The escrow is checked before the bounty exists, not after.
     *
     * A bounty that cannot be paid should never be posted, rather than be discovered unpayable by
     * whoever wins it. And the money, the deadline and the poster are then taken from the contract
     * rather than from this request — so a listing cannot claim more than is held, outlive the
     * escrow behind it, or attribute somebody else's money to the sender.
     */
    let backing: Backing | undefined;
    if (typeof body["escrowId"] === "string" && body["escrowId"].trim().length > 0) {
      if (!deps.escrow) {
        return fail(503, "this server cannot check an escrow, so it will not take a backed bounty");
      }
      const read = await deps.escrow.read(body["escrowId"]);
      if (!read.ok) {
        // Being unable to ask is our failure and costs a retry; a bad id is the poster's and does not.
        return "unavailable" in read ? unavailable(read.because) : fail(400, read.because);
      }
      backing = read.backing;
    }

    // A bar nobody here can check is a bar that means nothing, so it is not accepted.
    if (typeof body["minRating"] === "number" && body["minRating"] > 0 && !deps.reputation) {
      return fail(409, "this server has no reputation registry to check a record against, " +
        "so it cannot take a bounty that requires one. Post it with minRating 0");
    }

    const posted = deps.bounties!.post({ poster: agent, ...body } as never, Date.now(), backing);
    if (!posted.ok) {
      return json({ error: posted.problem, ...(posted.at ? { at: posted.at } : {}) }, 400);
    }
    return json(wireBounty(posted.bounty), 201);
  }

  if (seg[0] === "bounties" && seg[1]) {
    const bounty = deps.bounties!.get(seg[1]);
    if (!bounty) return fail(404, `no bounty ${seg[1]}`);

    if (req.method === "GET" && seg.length === 2) return json(wireBounty(bounty));

    /**
     * Retry a payout that never landed. Free, and safe to call repeatedly.
     *
     * Open to anyone, because there is nothing here to abuse: it can only send money to the address
     * already recorded as the winner, and it does nothing at all once a transaction has settled.
     * Requiring a key would mean a winner waiting on us to notice.
     */
    if (req.method === "POST" && seg[2] === "award") {
      if (!bounty.solvedBy) return fail(409, "nobody has won this bounty yet");
      if (bounty.awardTx) return json({ alreadyPaid: true, tx: bounty.awardTx });
      if (!bounty.escrowId) return fail(409, "this bounty has no escrow behind it to pay from");

      const payout = await payOut(deps, bounty.id);
      if (!payout?.ok) {
        return json({ paid: false, because: payout?.because ?? "no arbiter is configured" }, 503);
      }
      return json({ paid: true, tx: payout.tx, bounty: wireBounty(deps.bounties!.get(bounty.id)!) });
    }

    if (req.method === "POST" && seg[2] === "solve") {
      const agent = agentOf(req) ?? ANONYMOUS;
      const body = await bodyOf(req);
      if (!isRecord(body) || !("answer" in body)) return fail(400, 'solving takes a JSON object with an answer: {"answer": ...}');

      /**
       * Refused before charged, where we already know enough to refuse.
       *
       * The authoritative gate is inside `solve`, against the address that paid, because a header
       * is not an identity. But charging first meant an unqualified agent paid a graded-submission
       * fee to be told it could not play — the same tax on a rejected request that a malformed
       * probe is deliberately spared. A rating is public, so answering this early leaks nothing.
       */
      const claimed = claimedIdOf(req);
      let standing: number;
      try {
        standing = await ratingOf(deps, claimed);
      } catch {
        return unavailable("the reputation registry could not be read, so a record cannot be checked");
      }
      const eligible = deps.bounties!.eligibility(bounty.id, agent, standing);
      if (!eligible.ok) {
        if ("closed" in eligible) return json({ error: eligible.closed }, 409);
        return json({
          error: "this bounty is for agents with a record", rating: eligible.rating, needs: eligible.needs,
          how: HOW_TO_QUALIFY,
          charged: false,
        }, 403);
      }

      /**
       * Attempting a bounty is charged like a graded submission, and the payment is what names the
       * solver. A bounty pays an address; a header is not one.
       */
      const charge = await deps.payments.charge(agent, PRICE.submit, `bounty ${bounty.id}`, proofOf(req));
      if (!charge.ok) {
        if ("needsPayment" in charge) return paymentRequired(charge.needsPayment, path, deps.net);
        if ("unavailable" in charge) return unavailable(charge.unavailable);
        if (charge.refused === "payment") return paymentRefused(charge.reason, charge.quote, path, deps.net);
        return json({ refused: charge.refused, wanted: format(charge.wanted), remaining: format(charge.remaining) });
      }

      /**
       * The record counts only if the identity it was read for is paid for by the address that just
       * paid. Otherwise anyone could claim a qualified agent's id and borrow its rating.
       */
      const solver = charge.payer ?? agent;
      const owned = claimed !== null && deps.verifyIdentity !== undefined &&
        await deps.verifyIdentity(claimed, solver).catch(() => false);
      const out = deps.bounties!.solve(bounty.id, body.answer, solver, owned ? standing : 0);

      if (out.ok) {
        /**
         * Won first, paid second.
         *
         * The win is already recorded by the time this runs, and a failed payout must not undo it —
         * otherwise a prize would depend on the gas market at the moment somebody answered. A
         * bounty left with a winner and no transaction is reported as `awaitingPayout` and swept by
         * `POST /bounties/:id/award`.
         */
        const payout = await payOut(deps, bounty.id);
        return json({
          solved: true, solver: out.solver,
          ...(payout ? { payout } : {}),
          bounty: wireBounty(deps.bounties!.get(bounty.id)!),
        });
      }
      if ("unqualified" in out) {
        /**
         * Only reachable when the payer is a different identity from the header — the free check
         * above passed on the name and the authoritative one failed on the address. Rare, and the
         * agent's own doing, but it has been charged, so the body says so rather than pretending.
         */
        return json({
          error: "this bounty is for agents with a record", rating: out.rating, needs: out.needs,
          how: HOW_TO_QUALIFY,
          charged: true,
          note: "the record was read for the ERC-8004 id you sent, and that id is not paid for by the address that paid",
        }, 403);
      }
      if ("closed" in out) return json({ error: out.closed }, 409);
      return json({ solved: false, because: out.because, at: out.at });
    }
  }

  /**
   * What the chain says is left, for an account and the session key spending on its behalf.
   *
   * Read straight from the plugin rather than from anything the gym keeps, so the number an agent
   * sees here is the number that will do the refusing. Absent a reader — no plugin on this network —
   * this is a 404 rather than a guess.
   */
  if (req.method === "GET" && seg[0] === "allowance" && seg[1] && seg[2]) {
    if (!deps.allowances) return fail(404, `no session-key plugin on ${deps.net}, so nothing to read`);
    const found = await deps.allowances.of(seg[1], seg[2]);
    if (!found) return fail(404, "no allowance for that account and session key");
    return json({
      account: seg[1], sessionKey: seg[2],
      limit: format(found.limit), used: format(found.used), remaining: format(found.remaining),
      refreshInterval: found.refreshInterval, validUntil: found.validUntil, live: found.live,
    });
  }

  if (req.method === "GET" && seg[0] === "rating" && seg[1]) {
    /**
     * An ERC-8004 id is answered from the registry, the number the bounty gate uses, with what a
     * stranger needs to read it themselves: which registry, and whose entries count.
     */
    const agentId = parseAgentId(seg[1]);
    if (agentId !== null) {
      if (!deps.reputation) return fail(404, `no reputation registry on ${deps.net} to read a record from`);
      let problems: readonly string[];
      try {
        problems = await deps.reputation.ranked(agentId);
      } catch {
        return unavailable("the reputation registry could not be read");
      }
      const chain: ChainRatingWire = { agent: agentId.toString(), rating: weigh(problems), ranked: problems,
                                       scribe: deps.reputation.scribe, source: "erc-8004" };
      return json(chain);
    }
    const r = rate(deps.attempts.all(), seg[1]);
    return json({ ...r, spend: format(r.spend), best: r.best === null ? null : format(r.best) });
  }

  /** Cost to solve, cheapest first. Unsolved runs are listed but never rank above a solved one. */
  if (req.method === "GET" && seg[0] === "leaderboard" && seg[1]) {
    if (!problemOf(seg[1])) return fail(404, `no problem ${seg[1]}`);
    // Paid runs only. A first submission is free, so a lucky guess can solve a run nobody paid
    // for, and it would top the board at $0.00. A run nobody paid for is nobody's: `paidBy`.
    const solved = deps.attempts.all()
      .filter((a: Attempt) => a.outcome === "solved" && a.problem === seg[1] && a.payer !== null);
    const ranked = [...solved].sort((x, y) =>
      x.spend === y.spend ? x.probes.length - y.probes.length : (x.spend < y.spend ? -1 : 1));
    return json(ranked.map((a) => wireScore(score(a))));
  }

  /**
   * The browser app, where it has been built.
   *
   * Anything not an API route falls through to the single page, so a deep link works on a reload
   * rather than 404ing — the app decides what to render from the URL. Absent a build, this says so
   * instead of serving nothing.
   */
  if (req.method === "GET") {
    const served = await servedFile(path, wantsHtml(req));
    if (served) return served;
  }

  return fail(404, `no route for ${req.method} ${path}`);
}

/** The addresses a quote points at, for whichever network this process serves. */
export function quoteFor(net: Network, amount: bigint, payTo: string): Quote {
  return { amount, chain: caip2(net), token: contractsOf(net).usdc, payTo, scheme: "exact" };
}

export const currentNetwork = network;
