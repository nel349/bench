import { MAX_PATTERN } from "./check.ts";

/**
 * Accepting a regular expression from a stranger.
 *
 * `(a+)+$` against thirty `a`s takes longer than the heat death of the average HTTP timeout, and
 * JavaScript gives you no way to interrupt a running match — no timeout, no cancellation, nothing.
 * Once `RegExp.prototype.test` is on the stack the process belongs to the pattern. Capping the
 * subject length does not help: the blow-up is exponential in the *input*, so a few dozen characters
 * is already enough.
 *
 * So the check has to happen before the match, and it is deliberately conservative. It rejects
 * patterns that are merely suspicious, not only ones that are provably catastrophic, because the
 * cost of a false rejection is a poster rewording a pattern and the cost of a false acceptance is
 * the server.
 *
 * What it refuses:
 *   - a quantified group whose body itself quantifies or alternates — `(a+)+`, `(a|a)*`
 *   - one quantifier straight after another — `a+*`
 *   - backreferences, which make matching NP-hard in general
 *   - `g` and `y` flags, which carry `lastIndex` between calls and make a checker stateful
 */
export type PatternProblem = string | null;

const QUANTIFIER = new Set(["*", "+", "?", "{"]);
const ALLOWED_FLAGS = new Set(["i", "m", "s", "u"]);

export function refusePattern(pattern: string, flags = ""): PatternProblem {
  if (pattern.length === 0) return "the pattern is empty";
  if (pattern.length > MAX_PATTERN) return `the pattern is longer than ${MAX_PATTERN} characters`;

  for (const f of flags) {
    if (!ALLOWED_FLAGS.has(f)) {
      return f === "g" || f === "y"
        ? `the ${f} flag makes a checker stateful between runs`
        : `unsupported flag: ${f}`;
    }
  }

  // Each open group remembers whether anything inside it could backtrack.
  const stack: { risky: boolean }[] = [];
  let top = { risky: false };
  let prevWasQuantifier = false;
  let inClass = false;

  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;

    if (c === "\\") {
      const next = pattern[i + 1];
      if (next !== undefined && next >= "1" && next <= "9") return "backreferences are not accepted";
      if (next === "k") return "named backreferences are not accepted";
      i++; // the escaped character is literal, whatever it is
      prevWasQuantifier = false;
      continue;
    }

    // Inside a character class every metacharacter is literal, `]` included after the first position.
    if (inClass) {
      if (c === "]") inClass = false;
      continue;
    }
    if (c === "[") { inClass = true; prevWasQuantifier = false; continue; }

    if (c === "(") { stack.push(top); top = { risky: false }; prevWasQuantifier = false; continue; }

    if (c === ")") {
      const body = top;
      top = stack.pop() ?? { risky: false };
      const after = pattern[i + 1];
      const quantified = after !== undefined && QUANTIFIER.has(after);
      if (quantified && body.risky) {
        return "a quantified group that itself repeats or alternates can take exponential time";
      }
      // A group that could repeat makes whatever encloses it risky too.
      if (quantified || body.risky) top.risky = true;
      continue;
    }

    if (c === "|") { top.risky = true; prevWasQuantifier = false; continue; }

    if (QUANTIFIER.has(c)) {
      if (prevWasQuantifier && c !== "?") {
        // `a+?` is a lazy quantifier and fine; `a+*` is not a pattern anyone means.
        return "one quantifier immediately after another";
      }
      top.risky = true;
      prevWasQuantifier = c !== "?" || !prevWasQuantifier;
      continue;
    }

    prevWasQuantifier = false;
  }

  if (inClass) return "an unclosed character class";
  if (stack.length > 0) return "an unclosed group";

  try {
    new RegExp(pattern, flags);
  } catch (e) {
    return `not a valid pattern: ${e instanceof Error ? e.message : "unparseable"}`;
  }
  return null;
}
