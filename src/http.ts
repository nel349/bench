import { Attempts, score, wireAttempt, wireScore, type Attempt } from "./attempt.ts";
import type { AgentId, Payments, Quote } from "./payments.ts";
import { PRICE } from "./pricing.ts";
import { format } from "./money.ts";
import { allProblems, problemOf } from "./problems/problem.ts";
import "./problems/blackbox-problem.ts";
import "./problems/zendo.ts";
import { caip2, contractsOf, network, type Network } from "./arc/chain.ts";

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
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

const fail = (status: number, error: string): Response => json({ error }, status);

/** The x402 body, near enough to the wire format that a real client recognises it. */
function paymentRequired(q: Quote, resource: string): Response {
  return json({
    x402Version: 1,
    error: "payment required",
    accepts: [{
      scheme: q.scheme,
      network: q.chain,
      resource,
      maxAmountRequired: q.amount.toString(),
      asset: q.token,
      payTo: q.payTo,
    }],
  }, 402);
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

const SCORING = "Ranked by cost to solve. Ties break on fewest probes.";

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const seg = path.split("/").filter(Boolean);
  const prices = { ask: format(PRICE.ask), submit: format(PRICE.submit), rank: format(PRICE.rank) };

  if (req.method === "GET" && path === "/") {
    return json({
      service: "bench", network: deps.net, chain: caip2(deps.net),
      problems: allProblems().map((p) => p.id),
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

  if (req.method === "POST" && path === "/attempts") {
    const agent = agentOf(req);
    if (!agent) return fail(401, "name your agent in the X-Agent header");
    const body = (await req.json().catch(() => ({}))) as { seed?: number; problem?: string };
    const problem = body.problem ?? "blackbox";
    const seed = Number.isInteger(body.seed) ? body.seed! : Math.floor(Math.random() * 2 ** 31);
    const started = deps.attempts.start(agent, problem, seed);
    if (!started) return fail(404, `no problem ${problem}`);
    return json(wireAttempt(started), 201);
  }

  if (seg[0] === "attempts" && seg[1]) {
    const attempt = deps.attempts.get(seg[1]);
    if (!attempt) return fail(404, `no attempt ${seg[1]}`);

    if (req.method === "GET" && seg.length === 2) return json(wireAttempt(attempt));

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
