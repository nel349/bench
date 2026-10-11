import { ANONYMOUS, recordHash, score, wireAttempt, wireScore } from "../../gym/attempt.ts";
import { PRICE } from "../../shared/pricing.ts";
import { format, usdc, type Usdc } from "../../shared/money.ts";
import { allProblems, problemOf } from "../../problems/problem.ts";
import { drawSeed, fingerprint } from "../../problems/seed.ts";
import { caip2, chainOf, contractsOf, OWNER_WALLET } from "../../chain/chain.ts";
import { PATHS } from "../../shared/paths.ts";
import type { ProblemDetailWire, ProblemWire, SettingsWire } from "../../shared/wire.ts";
import type { RouteContext } from "../deps.ts";
import { json, fail, unavailable, agentOf, claimedIdOf, QUESTION_PARAM, ANSWER_PARAM, fromUrl, NO_BODY, bodyOf, isRecord, freeCap, limited } from "../respond.ts";
import { paymentRefused, paymentRequired, proofOf, receipted } from "../payment.ts";
import { wantsHtml } from "../page.ts";

const SCORING = "Ranked by cost to solve. Ties break on fewest probes.";
/** The harness's seed when none is asked for, so its examples are the same for everyone. */
const PRACTICE_SEED = "1";

/** The gym itself: what it serves, its problems and their harness, and a run from start to rank. */
export async function gymRoutes({ req, deps, client, url, path, seg, prices }: RouteContext): Promise<Response | null> {
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
      wallet: OWNER_WALLET[deps.net],
    };
    return json(settings);
  }
  if (req.method === "GET" && path === PATHS.problems) {
    return json(allProblems().map((p): ProblemWire =>
      ({ id: p.id, title: p.title, category: p.category, level: p.level, summary: p.summary, par: p.par, prices })));
  }
  if (req.method === "GET" && seg[0] === "problems" && seg[1]) {
    const problem = problemOf(seg[1]);
    if (!problem) return fail(404, `no problem ${seg[1]}`);

    if (seg.length === 2) {
      const detail: ProblemDetailWire = {
        id: problem.id, title: problem.title, category: problem.category,
        level: problem.level, summary: problem.summary, par: problem.par,
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
      const capped = freeCap(deps, client, "free requests");
      if (capped) return capped;
      const seed = url.searchParams.get("seed") ?? PRACTICE_SEED;
      return json({ problem: problem.id, seed, fingerprint: fingerprint(seed), ...(problem.harness(seed) as object) });
    }
  }
  if (req.method === "POST" && path === PATHS.attempts) {
    const capped = freeCap(deps, client, "runs started");
    if (capped) return capped;
    const agent = agentOf(req) ?? ANONYMOUS;
    const read = await bodyOf(req);
    // No body is allowed and means the URL, then the defaults; a body that is not an object is a mistake.
    if (read !== NO_BODY && !isRecord(read)) return fail(400, "starting a run takes a JSON object, or no body");
    const q = url.searchParams;
    const fromQuery = {
      ...(q.has("problem") ? { problem: q.get("problem")! } : {}),
      ...(q.has("budget") ? { budget: q.get("budget")! } : {}),
      ...(q.has("seed") ? { seed: q.get("seed") } : {}),
    };
    const body = (read === NO_BODY ? fromQuery : read) as { seed?: unknown; problem?: string; budget?: unknown };
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
     * The run as it is now. `attempt` is what was read before this request changed anything, and a
     * store that hands back copies, as SQLite does, leaves it stale: a solving submission once came
     * back with a score saying unsolved and still open.
     */
    const now = () => deps.attempts.get(attempt.id)!;

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
      const read = await bodyOf(req);
      const body = read === NO_BODY ? fromUrl(url, QUESTION_PARAM) : read;
      if (body === NO_BODY) return fail(400, `ask takes a JSON body, or the question as ?${QUESTION_PARAM}=`);
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
                      attempt: wireAttempt(now()) });
      }
      return receipted(json({ answer: out.answer, paid: format(out.paid), spend: format(out.spend) }),
                       out, deps.net);
    }

    if (req.method === "POST" && seg[2] === "submit") {
      const read = await bodyOf(req);
      const inUrl = fromUrl(url, ANSWER_PARAM);
      const body = read === NO_BODY && inUrl !== NO_BODY ? { answer: inUrl } : read;
      if (!isRecord(body) || !("answer" in body || "guess" in body)) {
        return fail(400, `submit takes a JSON object with an answer, {"answer": ...}, or ?${ANSWER_PARAM}=`);
      }
      const answer = "answer" in body ? body["answer"] : body["guess"];

      // Checked before anything is charged, spent only once a submission is actually graded, so a
      // 402 round trip does not count twice. Per paying address, or per client before anyone pays.
      const gradedKey = attempt.payer ?? `client:${client}`;
      const room = deps.limits?.graded.check(gradedKey);
      if (room && !room.ok) return limited(room.retryAfterMs, "graded submissions");
      const out = await deps.attempts.submit(attempt.id, answer, proofOf(req));
      if ("solved" in out) deps.limits?.graded.take(gradedKey);
      if ("needsPayment" in out) return paymentRequired(out.needsPayment, path, deps.net);
      if ("badPayment" in out) return paymentRefused(out.badPayment, out.quote, path, deps.net);
      if ("unavailable" in out) return unavailable(out.unavailable);
      if ("refused" in out) {
        return json({ refused: out.refused, wanted: format(out.wanted), remaining: format(out.remaining),
                      attempt: wireAttempt(now()) });
      }
      return receipted(json({ solved: out.solved, paid: format(out.paid), spend: format(out.spend),
                             submissions: out.submissions,
                             score: out.solved ? wireScore(score(now())) : null }), out, deps.net);
    }
  }

  return null;
}
