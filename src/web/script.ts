import { PATHS } from "./paths.ts";

/**
 * The live feed, client side.
 *
 * Every cell is set with `textContent` and every row built with `createElement`. Nothing here
 * concatenates HTML, so an agent that names itself `<img onerror=…>` is a funny row and not a hole —
 * the server escapes its half of the page, and this is the other half.
 *
 * It is a poll rather than a socket on purpose: a socket is a connection to keep alive, a reconnect
 * path and a deploy hazard, and this page is a table that changes a few times a minute.
 */
export const SCRIPT = `
(function () {
  var body = document.getElementById("feed");
  if (!body) return;

  function ago(t) {
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }

  function short(a) {
    if (!a) return "\\u2014";
    return a.length > 14 ? a.slice(0, 6) + "\\u2026" + a.slice(-4) : a;
  }

  function cell(text, cls) {
    var td = document.createElement("td");
    if (cls) td.className = cls;
    td.textContent = text;
    return td;
  }

  function row(r) {
    var tr = document.createElement("tr");

    var who = document.createElement("td");
    var name = document.createElement("span");
    name.className = "agent";
    name.textContent = r.agent;
    who.appendChild(name);
    if (r.payer) {
      var p = document.createElement("div");
      p.className = "proof";
      p.textContent = "paid by " + short(r.payer);
      who.appendChild(p);
    }
    tr.appendChild(who);

    tr.appendChild(cell(r.problem));

    var out = document.createElement("td");
    var tag = document.createElement("span");
    tag.className = "tag " + r.endedBy;
    tag.textContent = r.endedBy;
    out.appendChild(tag);
    tr.appendChild(out);

    tr.appendChild(cell(String(r.probes), "num"));
    tr.appendChild(cell("$" + r.spend, "num"));
    tr.appendChild(cell(ago(r.startedAt), "num"));
    return tr;
  }

  function draw(runs) {
    body.textContent = "";
    if (!runs.length) {
      var tr = document.createElement("tr");
      var td = cell("Nothing yet. The first run shows up here.", "empty");
      td.colSpan = 6;
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }
    for (var i = 0; i < runs.length; i++) body.appendChild(row(runs[i]));
  }

  var failures = 0;
  function tick() {
    fetch(${JSON.stringify(PATHS.feed)}, { headers: { accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (runs) { failures = 0; draw(runs); })
      // A server that is down should not turn into a page that hammers it. Back off, keep the
      // rows that are already on screen, and say nothing: the last state is still true.
      .catch(function () { failures++; })
      .then(function () {
        setTimeout(tick, Math.min(5000 * Math.pow(2, failures), 60000));
      });
  }
  setTimeout(tick, 5000);
})();
`.trim();
