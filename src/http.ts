import { Attempts, score, wireAttempt, wireScore, type Attempt } from "./attempt.ts";
import type { AgentId, Payments, Quote } from "./payments.ts";
import { PRICE } from "./pricing.ts";
import { format, usdc, type Usdc } from "./money.ts";
import { allProblems, problemOf } from "./problems/problem.ts";
import "./problems/blackbox-problem.ts";
import "./problems/zendo.ts";
import "./problems/toll.ts";
import { caip2, contractsOf, network, type Network } from "./arc/chain.ts";
import { parseAgentId } from "./arc/identity.ts";
import { wireBounty, type Bounties } from "./bounties.ts";
import { rate } from "./rating.ts";
import { PATHS, FEED_LIMIT } from "./web/paths.ts";
import { renderPage } from "./web/page.ts";
import { STYLE } from "./web/style.ts";
import { SCRIPT } from "./web/script.ts";

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
  /**
   * Bounties, where a server runs them. Optional rather than always-on: a gym with no escrow behind
   * it should answer 404 on these rather than take a posting it cannot pay out.
   */
  readonly bounties?: Bounties;
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
const paymentRefused = (reason: string, quote: Quote, path: string): Response =>
  json({
    x402Version: 1,
    error: `that payment was not accepted: ${reason}`,
    accepts: [accepts(quote, path)],
  }, 402);

/**
 * Our end broke. Deliberately **not** a 402, because the caller's money is fine and telling them
 * otherwise sends them to debug a wallet that has nothing wrong with it.
 */
const unavailable = (reason: string): Response =>
  json({ error: reason, retry: true }, 503, { "Retry-After": "5" });

/** One entry of an x402 `accepts` list: what to pay, where, and on which chain. */
const accepts = (q: Quote, resource: string) => ({
  scheme: q.scheme,
  network: q.chain,
  resource,
  maxAmountRequired: q.amount.toString(),
  asset: q.token,
  payTo: q.payTo,
});

/** The x402 body, near enough to the wire format that a real client recognises it. */
function paymentRequired(q: Quote, resource: string): Response {
  return json({ x402Version: 1, error: "payment required", accepts: [accepts(q, resource)] }, 402);
}

/**
 * Who is asking.
 *
 * A header today. It becomes the agent's ERC-8004 identity, proven by the payment's signer, once
 * payments are on chain — at which point identity stops being a claim the caller makes and starts
 * being a consequence of paying. Stated here rather than assumed, because a header is an honest
 * placeholder and a silent one is not.
 */
function agentOf(req: Request): AgentId | null {
  const id = req.headers.get("x-agent");
  return id && id.trim().length > 0 ? id.trim() : null;
}

const proofOf = (req: Request): string | null => req.headers.get("x-payment");

/**
 * The ERC-8004 id an agent says is its own.
 *
 * A claim, and treated as one: it is recorded on the run and only becomes an identity if the
 * registry says the address that paid is the wallet behind it. Malformed is silently no claim rather
 * than a 400 — an agent that sends a junk id still gets to run, it simply runs unidentified.
 */
const claimedIdOf = (req: Request): bigint | null => parseAgentId(req.headers.get("x-agent-id"));

const SCORING = "Ranked by cost to solve. Ties break on fewest probes.";

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
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[bench] ${req.method} ${new URL(req.url).pathname}: ${message}`);
    return json({ error: "something went wrong here, and it is not your request", detail: message }, 500);
  }
}

async function route(req: Request, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const seg = path.split("/").filter(Boolean);
  const prices = { ask: format(PRICE.ask), submit: format(PRICE.submit), rank: format(PRICE.rank) };

  /**
   * The index, as a page for a person and as JSON for a client.
   *
   * Negotiated rather than split across two paths, so the URL somebody pastes into a chat and the
   * one their agent fetches are the same URL. A browser sends `Accept: text/html`; nothing else does.
   */
  if (req.method === "GET" && path === PATHS.index) {
    if ((req.headers.get("accept") ?? "").includes("text/html")) {
      return new Response(renderPage(deps.attempts.all(), deps.net), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return json({
      service: "bench", network: deps.net, chain: caip2(deps.net),
      problems: allProblems().map((p) => p.id),
    });
  }

  if (req.method === "GET" && path === PATHS.style) {
    return new Response(STYLE, {
      headers: { "content-type": "text/css; charset=utf-8", "cache-control": "max-age=300" },
    });
  }

  if (req.method === "GET" && path === PATHS.script) {
    return new Response(SCRIPT, {
      headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "max-age=300" },
    });
  }

  if (req.method === "GET" && path === "/problems") {
    return json(allProblems().map((p) => ({ id: p.id, title: p.title, category: p.category, prices })));
  }

  if (req.method === "GET" && seg[0] === "problems" && seg[1]) {
    const problem = problemOf(seg[1]);
    if (!problem) return fail(404, `no problem ${seg[1]}`);

    if (seg.length === 2) {
      return json({
        id: problem.id, title: problem.title, category: problem.category,
        statement: problem.statement, scoring: SCORING, prices,
      });
    }

    /** The harness: everything needed to rebuild an instance and replay a run, offline and free. */
    if (seg[2] === "harness") {
      const seed = Number(url.searchParams.get("seed") ?? 1);
      return json({ problem: problem.id, seed, ...(problem.harness(seed) as object) });
    }
  }

  if (req.method === "POST" && path === PATHS.attempts) {
    const agent = agentOf(req);
    if (!agent) return fail(401, "name your agent in the X-Agent header");
    const body = (await req.json().catch(() => ({}))) as
      { seed?: number; problem?: string; budget?: unknown };
    const problem = body.problem ?? "blackbox";
    const seed = Number.isInteger(body.seed) ? body.seed! : Math.floor(Math.random() * 2 ** 31);

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
      const body = (await req.json().catch(() => null)) as { question?: unknown } | null;
      if (!body) return fail(400, "ask takes a JSON body");
      // A bare body is the question, so `{"side":"left","index":0}` works as well as `{"question":...}`.
      const question = "question" in body ? body.question : body;
      const out = await deps.attempts.ask(attempt.id, question, proofOf(req));
      if ("malformed" in out) {
        const p = problemOf(attempt.problem);
        return fail(400, `that is not a question this problem takes. See ${p ? `/problems/${p.id}/harness` : "the harness"}`);
      }
      if ("needsPayment" in out) return paymentRequired(out.needsPayment, path);
      if ("badPayment" in out) return paymentRefused(out.badPayment, out.quote, path);
      if ("unavailable" in out) return unavailable(out.unavailable);
      if ("refused" in out) {
        return json({ refused: out.refused, wanted: format(out.wanted), remaining: format(out.remaining),
                      attempt: wireAttempt(attempt) });
      }
      return json({ answer: out.answer, paid: format(out.paid), spend: format(out.spend) });
    }

    if (req.method === "POST" && seg[2] === "submit") {
      const body = (await req.json().catch(() => null)) as { answer?: unknown; guess?: unknown } | null;
      if (!body) return fail(400, "submit takes a JSON body with an answer");
      const answer = "answer" in body ? body.answer : body.guess;
      const out = await deps.attempts.submit(attempt.id, answer, proofOf(req));
      if ("needsPayment" in out) return paymentRequired(out.needsPayment, path);
      if ("badPayment" in out) return paymentRefused(out.badPayment, out.quote, path);
      if ("unavailable" in out) return unavailable(out.unavailable);
      if ("refused" in out) {
        return json({ refused: out.refused, wanted: format(out.wanted), remaining: format(out.remaining),
                      attempt: wireAttempt(attempt) });
      }
      return json({ solved: out.solved, paid: format(out.paid), spend: format(out.spend),
                    submissions: out.submissions, score: out.solved ? wireScore(score(attempt)) : null });
    }
  }

  if (req.method === "GET" && seg[0] === "agents" && seg[1]) {
    const mine = deps.attempts.all().filter((a) => a.agent === seg[1]);
    return json({
      agent: seg[1],
      spend: format(deps.payments.spentBy(seg[1]!)),
      attempts: mine.length,
      solved: mine.filter((a) => a.outcome === "solved").length,
      refused: mine.filter((a) => a.outcome === "refused").length,
      runs: mine.map((a) => wireScore(score(a))),
    });
  }

  /**
   * Recent runs across every problem, newest first — **including the refused ones**.
   *
   * A leaderboard shows who won. This shows what it cost and who ran out, which is the part that
   * makes the number mean anything. Hiding refusals would make the gym look easier than it is.
   */
  if (req.method === "GET" && path === PATHS.feed) {
    const recent = [...deps.attempts.all()]
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
    const agent = agentOf(req);
    if (!agent) return fail(401, "name your agent in the X-Agent header");
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail(400, "posting a bounty takes a JSON body");

    const posted = deps.bounties!.post({ poster: agent, ...body } as never);
    if (!posted.ok) {
      return json({ error: posted.problem, ...(posted.at ? { at: posted.at } : {}) }, 400);
    }
    return json(wireBounty(posted.bounty), 201);
  }

  if (seg[0] === "bounties" && seg[1]) {
    const bounty = deps.bounties!.get(seg[1]);
    if (!bounty) return fail(404, `no bounty ${seg[1]}`);

    if (req.method === "GET" && seg.length === 2) return json(wireBounty(bounty));

    if (req.method === "POST" && seg[2] === "solve") {
      const agent = agentOf(req);
      if (!agent) return fail(401, "name your agent in the X-Agent header");
      const body = (await req.json().catch(() => null)) as { answer?: unknown } | null;
      if (!body || !("answer" in body)) return fail(400, "solving takes a JSON body with an answer");

      /**
       * Attempting a bounty is charged like a graded submission, and the payment is what names the
       * solver. A bounty pays an address; a header is not one.
       */
      const charge = await deps.payments.charge(agent, PRICE.submit, `bounty ${bounty.id}`, proofOf(req));
      if (!charge.ok) {
        if ("needsPayment" in charge) return paymentRequired(charge.needsPayment, path);
        if ("unavailable" in charge) return unavailable(charge.unavailable);
        if (charge.refused === "payment") return paymentRefused(charge.reason, charge.quote, path);
        return json({ refused: charge.refused, wanted: format(charge.wanted), remaining: format(charge.remaining) });
      }

      const solver = charge.payer ?? agent;
      const out = deps.bounties!.solve(bounty.id, body.answer, solver, deps.attempts.all());

      if (out.ok) return json({ solved: true, solver: out.solver, bounty: wireBounty(bounty) });
      if ("unqualified" in out) {
        // 403: the request is well formed and paid for, and the agent is simply not allowed yet.
        return json({
          error: "this bounty is for agents with a record", rating: out.rating, needs: out.needs,
          how: `solve ${out.needs} different problems here first`,
        }, 403);
      }
      if ("closed" in out) return json({ error: out.closed }, 409);
      return json({ solved: false, because: out.because, at: out.at });
    }
  }

  if (req.method === "GET" && seg[0] === "rating" && seg[1]) {
    const r = rate(deps.attempts.all(), seg[1]);
    return json({ ...r, spend: format(r.spend), best: r.best === null ? null : format(r.best) });
  }

  /** Cost to solve, cheapest first. Unsolved runs are listed but never rank above a solved one. */
  if (req.method === "GET" && seg[0] === "leaderboard" && seg[1]) {
    if (!problemOf(seg[1])) return fail(404, `no problem ${seg[1]}`);
    const solved = deps.attempts.all().filter((a: Attempt) => a.outcome === "solved" && a.problem === seg[1]);
    const ranked = [...solved].sort((x, y) =>
      x.spend === y.spend ? x.probes.length - y.probes.length : (x.spend < y.spend ? -1 : 1));
    return json(ranked.map((a) => wireScore(score(a))));
  }

  return fail(404, `no route for ${req.method} ${path}`);
}

/** The addresses a quote points at, for whichever network this process serves. */
export function quoteFor(net: Network, amount: bigint, payTo: string): Quote {
  return { amount, chain: caip2(net), token: contractsOf(net).usdc, payTo, scheme: "exact" };
}

export const currentNetwork = network;
