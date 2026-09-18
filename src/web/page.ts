import { html, trusted, type Safe } from "./html.ts";
import { PATHS, FEED_LIMIT } from "./paths.ts";
import { format } from "../money.ts";
import { PRICE } from "../pricing.ts";
import { allProblems } from "../problems/problem.ts";
import { score, type Attempt } from "../attempt.ts";
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
export function renderPage(attempts: Attempt[], net: Network, now = Date.now()): string {
  const recent = [...attempts].sort((x, y) => y.startedAt - x.startedAt).slice(0, FEED_LIMIT);
  const spent = attempts.reduce((t, a) => t + a.spend, 0n);
  const solved = attempts.filter((a) => a.outcome === "solved").length;

  const cards = allProblems().map((p) => html`<div class="card">
    <h3>${p.title}</h3>
    <p>${p.category}</p>
    <div class="price">ask $${format(PRICE.ask)} · submit $${format(PRICE.submit)}</div>
  </div>`);

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
