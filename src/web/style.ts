/**
 * The whole stylesheet, served from one route.
 *
 * Inlining it into the page would re-send it on every poll-driven reload and make the HTML harder to
 * read; a build step would be a toolchain for one file. A string and a route is the smallest thing
 * that is still cacheable.
 */
export const STYLE = `
:root {
  --ink: #101418; --dim: #5b6670; --line: #e3e7ea; --bg: #fbfcfd; --panel: #fff;
  --win: #0a7d4b; --lose: #b3261e; --open: #9a6700; --accent: #1b4dd8;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ink: #e8edf2; --dim: #98a3ad; --line: #232a31; --bg: #0d1116; --panel: #131a21;
    --win: #4ad48c; --lose: #ff7b72; --open: #e3b341; --accent: #7aa2ff;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
}
.wrap { max-width: 860px; margin: 0 auto; padding: 40px 20px 72px; }
h1 { font-size: 30px; letter-spacing: -0.02em; margin: 0 0 6px; }
h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--dim);
     margin: 40px 0 12px; font-weight: 600; }
.lede { color: var(--dim); margin: 0 0 4px; max-width: 58ch; }
.net { font-size: 13px; color: var(--dim); margin-top: 14px; }
.net code { background: var(--panel); border: 1px solid var(--line); border-radius: 5px;
            padding: 1px 6px; font-size: 12px; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;
     color: var(--dim); font-weight: 600; padding: 0 10px 8px 0; border-bottom: 1px solid var(--line); }
td { padding: 9px 10px 9px 0; border-bottom: 1px solid var(--line); }
td.num, th.num { text-align: right; padding-right: 0; }
.agent { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.tag { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
.solved { color: var(--win); } .refused { color: var(--lose); }
.open, .abandoned { color: var(--open); }
.proof { font-size: 11px; color: var(--dim); font-family: ui-monospace, Menlo, monospace; }
.cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 9px; padding: 14px 16px; }
.card h3 { margin: 0 0 4px; font-size: 15px; }
.card p { margin: 0; color: var(--dim); font-size: 13px; }
.price { margin-top: 9px; font-size: 12px; color: var(--dim); font-variant-numeric: tabular-nums; }
.empty { color: var(--dim); font-size: 14px; padding: 18px 0; }
footer { margin-top: 48px; padding-top: 18px; border-top: 1px solid var(--line);
         color: var(--dim); font-size: 13px; }
a { color: var(--accent); }
`.trim();
