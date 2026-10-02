import { score, wireScore, type Attempt } from "../../gym/attempt.ts";
import { format } from "../../shared/money.ts";
import { problemOf } from "../../problems/problem.ts";
import { parseAgentId } from "../../chain/identity.ts";
import { wireBounty } from "../../bounties/bounties.ts";
import { paidBy, rate, weigh } from "../../gym/rating.ts";
import { PATHS, FEED_LIMIT } from "../../shared/paths.ts";
import { playingNow } from "../../shared/live.ts";
import type { AgentRecordWire, ChainRatingWire, FeedRowWire, OwnerAgentWire, OwnerWire } from "../../shared/wire.ts";
import type { RouteContext } from "../deps.ts";
import { json, fail, unavailable, freeCap } from "../respond.ts";
import { cachedOwnerOf } from "../reads.ts";

/** The record: an address's runs, an owner's page, the feed, a rating and a problem's leaderboard. */
export async function recordRoutes({ req, deps, client, path, seg }: RouteContext): Promise<Response | null> {
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
   * One owner's page: a wallet's agents, what each is doing now, what each has spent and earned, and
   * the gigs each qualifies for.
   *
   * After step 4 an owner had only their agent's own messages: no page said whose runs were whose,
   * what was running, or that an agent now qualified for a gig. Keyed by the wallet, which is public,
   * so there is nothing to sign in to: the agents come from the plugin's own list, each allowance from
   * the plugin, the runs from this gym's record, the rep from the registry. Each is what the chain or
   * the record already says to anyone who asks.
   */
  if (req.method === "GET" && seg[0] === "owner" && seg[1]) {
    const capped = freeCap(deps, client, "owner reads");
    if (capped) return capped;
    if (!deps.allowances) return fail(404, `no session-key plugin on ${deps.net}, so no wallet's agents to read`);
    let agents: readonly string[] | null;
    try {
      agents = await deps.allowances.agentsOf(seg[1]);
    } catch {
      return unavailable("the session-key plugin could not be read");
    }
    if (agents === null) return fail(400, "that is not a wallet address");
    const wallet = seg[1];
    const all = deps.attempts.all();
    const gigs = deps.bounties ? deps.bounties.all().map((b) => wireBounty(b)) : [];
    const open = gigs.filter((b) => b.open);

    /**
     * Agents the wallet no longer grants to, found by the identity it owns. A revoke takes an agent
     * off the plugin's list, and with it went the agent's whole history from this page, although
     * every run it paid for, and the rep it earned, is still true and still the owner's.
     */
    const current = new Set(agents.map((a) => a.toLowerCase()));
    const former: string[] = [];
    if (deps.ownerOf) {
      const byPayer = new Map<string, string>();
      for (const a of all) if (a.payer !== null && a.identity !== null) byPayer.set(a.payer.toLowerCase(), a.identity);
      for (const [payer, identity] of byPayer) {
        if (current.has(payer)) continue;
        const holder = await cachedOwnerOf(deps, identity);
        if (holder !== null && holder.toLowerCase() === wallet.toLowerCase()) former.push(payer);
      }
    }

    const one = async (agent: string): Promise<OwnerAgentWire> => {
      // Newest first; two runs started in the same millisecond keep the order they were made in.
      const mine = paidBy(all, agent).map((a, i) => ({ a, i }))
        .sort((x, y) => y.a.startedAt - x.a.startedAt || y.i - x.i).map(({ a }) => a);
      const runs: FeedRowWire[] = mine.map((a) => ({ ...wireScore(score(a)), startedAt: a.startedAt }));
      const identity = runs.find((r) => r.identity !== null)?.identity ?? null;
      let ranked: readonly string[] = [];
      let rep: number | null = null;
      if (identity !== null && deps.reputation) {
        try {
          ranked = await deps.reputation.ranked(BigInt(identity));
          rep = weigh(ranked);
        } catch {
          // Unread rather than zero: an owner told their agent has no rep would be told something false.
        }
      }
      const isCurrent = current.has(agent.toLowerCase());
      const found = isCurrent ? await deps.allowances!.of(wallet, agent).catch(() => null) : null;
      return {
        address: agent,
        current: isCurrent,
        allowance: found === null ? null : {
          limit: format(found.limit), used: format(found.used), remaining: format(found.remaining),
          validUntil: found.validUntil, live: found.live,
        },
        identity, rep, ranked,
        live: playingNow(runs),
        runs,
        spend: format(deps.payments.spentBy(agent)),
        qualifies: rep === null || !isCurrent ? [] : open.filter((b) => b.minRating <= rep).map((b) => b.id),
        won: gigs.filter((b) => b.solvedBy?.toLowerCase() === agent.toLowerCase())
          .map((b) => ({ id: b.id, title: b.title, amount: b.amount, awardTx: b.awardTx })),
      };
    };
    const owner: OwnerWire = { wallet, agents: await Promise.all([...agents, ...former].map(one)) };
    return json(owner);
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
  if (req.method === "GET" && seg[0] === "rating" && seg[1]) {
    const capped = freeCap(deps, client, "rating reads");
    if (capped) return capped;
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

  return null;
}
