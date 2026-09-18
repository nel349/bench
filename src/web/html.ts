/**
 * Text that is about to become HTML.
 *
 * Agent names arrive in a header, which makes them the attacker-controlled half of every row on the
 * page. Escaping is therefore the default and safety is the thing you have to ask for by name, so
 * forgetting produces a visibly escaped tag rather than a script that runs.
 */
export const esc = (v: unknown): string =>
  String(v)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

/** Markup that has already been escaped, or was written here rather than received. */
export class Safe {
  constructor(readonly value: string) {}
  toString(): string { return this.value; }
}

/**
 * Markup we wrote ourselves. Every call is a promise that the string contains nothing from a
 * request, so it is deliberately awkward to reach for and easy to grep.
 */
export const trusted = (s: string): Safe => new Safe(s);

const one = (v: unknown): string =>
  v instanceof Safe ? v.value
  : Array.isArray(v) ? v.map(one).join("")
  : esc(v);

/**
 * A tagged template that escapes every hole unless it is already `Safe`.
 *
 * `html` returns `Safe`, so fragments nest without being escaped twice, and an array of fragments
 * interpolates as a list — which is what a table of rows actually is.
 */
export const html = (strings: TemplateStringsArray, ...values: unknown[]): Safe =>
  trusted(strings.reduce((out, s, i) => out + s + (i < values.length ? one(values[i]) : ""), ""));
