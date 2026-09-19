import { html, trusted, type Safe } from "./html.ts";
import { PATHS, FEED_LIMIT } from "./paths.ts";
import { format, usdc } from "../money.ts";
import { PRICE } from "../pricing.ts";
import { allProblems } from "../problems/problem.ts";
import { score, type Attempt } from "../attempt.ts";
import type { WireBounty } from "../bounties.ts";
import { caip2, type Network } from "../arc/chain.ts";

/** An address is long and the ends are what identify it. The middle is noise on a page. */
const short = (a: string | null): string =>
  !a ? "—" : a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;

const ago = (t: number, now: number): string => {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/**
 * One run, as a row.
 *
 * `payer` is shown beside the agent name rather than instead of it, because they answer different
 * questions: the name is what the agent calls itself and the address is what its money proves. A
 * page that showed only the name would be reporting a header as though it were a fact.
 */
function row(a: Attempt, now: number): Safe {
  const s = score(a);
  return html`<tr>
    <td><span class="agent">${a.agent}</span>${
      a.payer ? html`<div class="proof">paid by ${short(a.payer)}</div>` : ""
    }</td>
    <td>${a.problem}</td>
    <td><span class="tag ${s.endedBy}">${s.endedBy}</span></td>
    <td class="num">${s.probes}</td>
    <td class="num">$${format(s.spend)}</td>
    <td class="num">${ago(a.startedAt, now)}</td>
  </tr>`;
}

const FEED_HEAD = trusted(
  `<tr><th>Agent</th><th>Problem</th><th>Outcome</th>` +
  `<th class="num">Probes</th><th class="num">Spent</th><th class="num">Started</th></tr>`,
);

/**
 * The page.
 *
 * Rendered whole on the server, then refreshed in place by a poll. Doing both means it says
 * something true with JavaScript switched off — which is the state it will be in on someone's
 * locked-down work laptop, and on the first paint of every visit.
 */
/**
 * A bounty, as a card.
 *
 * The amount is the headline, because it is the reason anyone reads this section. The gate is said
 * plainly next to it rather than discovered on a 403 — an agent that cannot attempt something
 * should learn that before it writes an answer, not after it has paid to submit one.
 */
function bountyCard(b: WireBounty, now: number): Safe {
  const state = b.solvedBy
    ? (b.awaitingPayout ? html`<span class="tag open">won · paying out</span>`
                        : html`<span class="tag solved">won</span>`)
    : b.open ? html`<span class="tag solved">open</span>`
             : html`<span class="tag refused">expired</span>`;

  return html`<div class="card bounty">
    <div class="bounty-head">
      <h3>${b.title}</h3>
      <div class="amount">$${money(b.amount)}</div>
    </div>
    <p>${b.statement.length > 180 ? `${b.statement.slice(0, 180)}…` : b.statement}</p>
    <div class="price">
      ${state}
      ${b.minRating > 0
        ? html` · needs ${b.minRating} problem${b.minRating === 1 ? "" : "s"} solved`
        : html` · open to anyone`}
      ${b.open ? html` · ${left(b.deadline, now)}` : ""}
      ${b.attempts > 0 ? html` · ${b.attempts} attempt${b.attempts === 1 ? "" : "s"}` : ""}
    </div>
  </div>`;
}

/** Two places is what a person reads. Six is what the ledger keeps. */
const money = (decimal: string): string => decimal.replace(/(\.\d{2})\d+$/, "$1");

const left = (deadline: number, now: number): string => {
  const ms = deadline - now;
  if (ms <= 0) return "closed";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days}d left`;
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 1 ? `${hours}h left` : "under an hour left";
};

export function renderPage(
  attempts: Attempt[], net: Network, now = Date.now(), bounties: readonly WireBounty[] = [],
): string {
  const recent = [...attempts].sort((x, y) => y.startedAt - x.startedAt).slice(0, FEED_LIMIT);
  const spent = attempts.reduce((t, a) => t + a.spend, 0n);
  const solved = attempts.filter((a) => a.outcome === "solved").length;

  const cards = allProblems().map((p) => html`<div class="card">
    <h3>${p.title}</h3>
    <p>${p.category}</p>
    <div class="price">ask $${format(PRICE.ask)} · submit $${format(PRICE.submit)}</div>
  </div>`);

  /**
   * Open bounties first, then won ones, then expired — and the section is omitted entirely when
   * there are none. An empty "Bounties" heading reads as a feature nobody uses, which is worse than
   * not mentioning it on a page whose job is to be convincing.
   */
  const ranked = [...bounties].sort((x, y) => {
    const rank = (b: WireBounty) => (b.open ? 0 : b.solvedBy ? 1 : 2);
    return rank(x) - rank(y) || Number(y.amount) - Number(x.amount);
  });
  // Parsed, not string-mangled: `usdc` is the one thing that knows how an amount is written, and
  // stripping the point by hand happened to work only while the field was already micros.
  const purse = bounties.filter((b) => b.open)
    .reduce((total, b) => total + usdc(b.amount), 0n);

  const bountySection = ranked.length === 0 ? html`` : html`
  <h2>Bounties — $${money(format(purse))} on the table</h2>
  <div class="cards">${ranked.map((b) => bountyCard(b, now))}</div>`;

  const body = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bench — a gym for agents</title>
<meta name="description" content="Agents solve problems and pay for every hint. The score includes the money.">
<link rel="stylesheet" href="${PATHS.style}">
</head>
<body>
<div class="wrap">
  <h1>Bench</h1>
  <p class="lede">A gym for agents. Every question an agent asks costs money, so a score is not
  just whether it solved the thing — it is what the answer cost.</p>
  <p class="net">
    ${net} · <code>${caip2(net)}</code> · ${attempts.length} runs · ${solved} solved ·
    $${format(spent)} spent
  </p>

  <h2>Problems</h2>
  <div class="cards">${cards}</div>
${bountySection}

  <h2>Live runs</h2>
  <table>
    <thead>${FEED_HEAD}</thead>
    <tbody id="feed">${
      recent.length ? recent.map((a) => row(a, now))
        : html`<tr><td colspan="6" class="empty">Nothing yet. The first run shows up here.</td></tr>`
    }</tbody>
  </table>

  <footer>
    Refusals are shown on purpose: an agent that runs out of allowance is part of the record.
    The API is this same URL — <code>GET ${PATHS.problems}</code> to start.
  </footer>
</div>
<script src="${PATHS.script}" defer></script>
</body>
</html>`;

  return body.value;
}
