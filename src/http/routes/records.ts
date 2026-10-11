import { costToPayer, score, wireScore, type Attempt } from "../../gym/attempt.ts";
import { format } from "../../shared/money.ts";
import { allProblems, problemOf } from "../../problems/problem.ts";
import { parseAgentId } from "../../chain/identity.ts";
import { wireBounty } from "../../bounties/bounties.ts";
import { paidBy, rate, weigh } from "../../gym/rating.ts";
import { standings } from "../../gym/standings.ts";
import { PATHS, FEED_LIMIT } from "../../shared/paths.ts";
import { playingNow } from "../../shared/live.ts";
import type { AgentRecordWire, ChainRatingWire, OwnerAgentWire, OwnerRunWire, OwnerWire, StandingsWire } from "../../shared/wire.ts";
import type { Deps, RouteContext } from "../deps.ts";
import { json, fail, unavailable, freeCap } from "../respond.ts";
import { cachedOwnerOf } from "../reads.ts";

/** The record: an address's runs, an owner's page, the feed, a rating, a problem's leaderboard and the standings. */
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
    const page = await ownerPage(deps, seg[1]);
    if ("unreadable" in page) return unavailable(page.unreadable);
    if ("notAWallet" in page) return fail(400, "that is not a wallet address");
    return json(page.owner);
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
  /** Who is ahead across every problem, and who holds the best ranked solve on each. See `standings`. */
  if (req.method === "GET" && path === PATHS.standings) {
    const { agents, best } = standings(deps.attempts.all());
    const order = allProblems().map((p) => p.id);
    const table: StandingsWire = {
      agents: agents.slice(0, STANDINGS_SHOWN),
      best: [...best].sort((x, y) => order.indexOf(x.problem) - order.indexOf(y.problem))
        .map((a) => ({ problem: a.problem, identity: a.identity, spend: format(a.spend), probes: a.probes.length, attempt: a.id })),
      more: Math.max(0, agents.length - STANDINGS_SHOWN),
    };
    return json(table);
  }

  return null;
}

/** How many agents the standings carry. Past it the table says how many more there are. */
export const STANDINGS_SHOWN = 100;

/** How many of a wallet's agents one page carries. Each costs two reads of the chain. */
export const OWNER_AGENTS_SHOWN = 20;
/**
 * How long an owner's page is the same page. A tab watching a run asks every three seconds, and
 * every tab asking at once is answered from one reading of the chain.
 */
export const OWNER_PAGE_MS = 3_000;
/** How many wallets' pages are kept at once. Past it the oldest go, so asking about many wallets cannot grow the gym. */
export const OWNER_PAGES_KEPT = 200;

const WALLET = /^0x[0-9a-fA-F]{40}$/;

type OwnerPage =
  | { readonly owner: OwnerWire }
  | { readonly unreadable: string }
  | { readonly notAWallet: true };
/** `doneAt` is when the reading finished, and `null` while it is still being read. */
type Kept = { readonly page: Promise<OwnerPage>; doneAt: number | null };
const pages = new WeakMap<Deps, Map<string, Kept>>();

/**
 * One wallet's page, read once for everyone asking in the same few seconds.
 *
 * Anyone may ask about any wallet, and each answer reads the chain, so an answer is shared while it
 * is being read and for a few seconds after. Only a whole answer is kept: one in which a read failed
 * is given to whoever was waiting and then asked again, so a hiccup is never served twice. Only for
 * something shaped like a wallet, and only so many of them: what is kept is bounded whatever is asked.
 */
function ownerPage(deps: Deps, wallet: string): Promise<OwnerPage> {
  if (!WALLET.test(wallet)) return Promise.resolve({ notAWallet: true });
  const known = pages.get(deps) ?? new Map<string, Kept>();
  pages.set(deps, known);
  const key = wallet.toLowerCase();
  const hit = known.get(key);
  if (hit && (hit.doneAt === null || Date.now() - hit.doneAt < OWNER_PAGE_MS)) return hit.page;

  const reading = readOwnerPage(deps, wallet);
  const kept: Kept = { page: reading.then((r) => r.page), doneAt: null };
  known.delete(key);
  known.set(key, kept);
  const forget = () => { if (known.get(key) === kept) known.delete(key); };
  reading.then((r) => { if (r.whole) kept.doneAt = Date.now(); else forget(); }, forget);

  // Stale ones first, then the oldest that has finished, which a Map keeps in the order they were
  // put in. One still being read is never dropped: whoever asks next would start a second reading of
  // the same page. Those are few, since each is a request in flight, and each goes when it is done.
  if (known.size > OWNER_PAGES_KEPT) {
    for (const [k, v] of known) if (v.doneAt !== null && Date.now() - v.doneAt >= OWNER_PAGE_MS) known.delete(k);
    for (const [k, v] of known) {
      if (known.size <= OWNER_PAGES_KEPT) break;
      if (v.doneAt !== null) known.delete(k);
    }
  }
  return kept.page;
}

async function readOwnerPage(deps: Deps, wallet: string): Promise<{ readonly page: OwnerPage; readonly whole: boolean }> {
  let granted: readonly string[] | null;
  try {
    granted = await deps.allowances!.agentsOf(wallet);
  } catch {
    return { page: { unreadable: "the session-key plugin could not be read" }, whole: false };
  }
  if (granted === null) return { page: { notAWallet: true }, whole: false };
  let whole = true;
  const all = deps.attempts.all();
  const gigs = deps.bounties ? deps.bounties.all().map((b) => wireBounty(b)) : [];
  const open = gigs.filter((b) => b.open);

  /**
   * Agents the wallet does not grant to now, found by the identity it holds. A revoke takes an agent
   * off the plugin's list, and with it went the agent's whole history from this page, although
   * every run it paid for, and the rep it earned, is still true and still the owner's.
   *
   * All asked at once: one after another, a registry that was down made every wallet's page wait a
   * second for each identity in the record.
   */
  const current = new Set(granted.map((a) => a.toLowerCase()));
  const lastRun = new Map<string, number>();
  const byPayer = new Map<string, string>();
  for (const a of all) {
    if (a.payer === null) continue;
    const payer = a.payer.toLowerCase();
    lastRun.set(payer, Math.max(lastRun.get(payer) ?? 0, a.startedAt));
    if (a.identity !== null) byPayer.set(payer, a.identity);
  }
  const former: string[] = [];
  if (deps.ownerOf) {
    const others = [...byPayer].filter(([payer]) => !current.has(payer));
    const held = await Promise.all(others.map(([, identity]) =>
      cachedOwnerOf(deps, identity).then((holder) => holder?.toLowerCase() === wallet.toLowerCase(), () => null)));
    others.forEach(([payer], i) => {
      // Not known this time: left out rather than guessed at, and the page says it is not whole.
      if (held[i] === null) whole = false;
      else if (held[i]) former.push(payer);
    });
  }

  const one = async (agent: string): Promise<OwnerAgentWire> => {
    // Newest first; two runs started in the same millisecond keep the order they were made in.
    const mine = paidBy(all, agent).map((a, i) => ({ a, i }))
      .sort((x, y) => y.a.startedAt - x.a.startedAt || y.i - x.i).map(({ a }) => a);
    const runs: OwnerRunWire[] = mine.map((a) => (
      { ...wireScore(score(a)), startedAt: a.startedAt, paid: format(costToPayer(a)) }
    ));
    const identity = runs.find((r) => r.identity !== null)?.identity ?? null;
    let ranked: readonly string[] = [];
    let rep: number | null = null;
    let repUnread = false;
    if (identity !== null && deps.reputation) {
      try {
        ranked = await deps.reputation.ranked(BigInt(identity));
        rep = weigh(ranked);
      } catch {
        // Unread, and said to be: an owner told their agent has no rep would be told something false.
        repUnread = true;
        whole = false;
      }
    }
    const isCurrent = current.has(agent.toLowerCase());
    const found = isCurrent
      ? await deps.allowances!.of(wallet, agent).catch(() => { whole = false; return null; })
      : null;
    return {
      address: agent,
      current: isCurrent,
      allowance: found === null ? null : {
        limit: format(found.limit), used: format(found.used), remaining: format(found.remaining),
        validUntil: found.validUntil, live: found.live,
      },
      identity, rep, repUnread, ranked,
      live: playingNow(runs),
      runs,
      spend: format(mine.reduce((total, a) => total + costToPayer(a), 0n)),
      // A gig that asks for no rep admits an agent that has none, or whose rep could not be read.
      qualifies: !isCurrent ? [] : open.filter((b) => b.minRating <= (rep ?? 0)).map((b) => b.id),
      won: gigs.filter((b) => b.solvedBy?.toLowerCase() === agent.toLowerCase())
        .map((b) => ({ id: b.id, title: b.title, amount: b.amount, awardTx: b.awardTx })),
    };
  };
  // The ones that played most recently first, so a wallet with more agents than a page carries
  // keeps the one being watched; the rest stay in the order the plugin lists them.
  const listed = [...granted, ...former]
    .map((agent, i) => ({ agent, i, last: lastRun.get(agent.toLowerCase()) ?? 0 }))
    .sort((x, y) => y.last - x.last || x.i - y.i).map(({ agent }) => agent);
  const shown = listed.slice(0, OWNER_AGENTS_SHOWN);
  const agents = await Promise.all(shown.map(one));
  const owner: OwnerWire = { wallet, agents, more: listed.length - shown.length, partial: !whole };
  return { page: { owner }, whole };
}
