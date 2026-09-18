import { expect, test, describe } from "bun:test";
import { refusePattern } from "./regex.ts";
import { MAX_PATTERN } from "./check.ts";

const ok = (p: string, f?: string) => expect(refusePattern(p, f)).toBe(null);
const no = (p: string, f?: string) => expect(refusePattern(p, f)).not.toBe(null);

describe("patterns a poster may use", () => {
  test("ordinary ones are accepted", () => {
    ok("^[a-f0-9]{64}$");
    ok("hello world");
    ok("^\\d+\\.\\d{2}$");
    ok("colou?r");
    ok("(cat|dog)");        // alternation is fine when nothing repeats it
    ok("a+");               // so is a quantifier when nothing repeats it
    ok("(ab)+");            // and a quantified group whose body cannot backtrack
    ok("[+*]{2,}");         // metacharacters inside a class are literal
  });

  test("case-insensitive and multiline are allowed", () => {
    ok("^x$", "im");
    ok(".", "s");
  });
});

describe("patterns that would hang the process", () => {
  test("the classic nested quantifier", () => no("(a+)+$"));
  test("a starred star", () => no("(a*)*"));
  test("a quantified alternation of the same thing", () => no("(a|a)*"));
  test("quantified group containing a quantifier, one level down", () => no("((a+))+"));
  test("a quantifier straight after a quantifier", () => no("a+*"));
  test("the email pattern everyone copies", () => no("^([a-zA-Z0-9_\\.\\-])+\\@(([a-zA-Z0-9\\-])+\\.)+([a-zA-Z0-9]{2,4})+$"));
});

describe("what is refused outright", () => {
  test("backreferences, which make matching NP-hard", () => {
    no("(a)\\1");
    no("(?<x>a)\\k<x>");
  });

  test("the g and y flags, which carry state between calls", () => {
    expect(refusePattern("a", "g")).toContain("stateful");
    expect(refusePattern("a", "y")).toContain("stateful");
  });

  test("an unknown flag", () => no("a", "Q"));
  test("an empty pattern", () => no(""));
  test("a pattern longer than the cap", () => no("a".repeat(MAX_PATTERN + 1)));
  test("something that is not a pattern at all", () => no("a{2,1}"));
  test("an unclosed group", () => no("(abc"));
  test("an unclosed class", () => no("[abc"));
});

/**
 * The guard is only worth having if it actually beats the thing it is guarding against. This runs
 * the refused pattern against input that would take an unbounded time, and passes because the guard
 * refused it before `RegExp` ever saw it.
 */
describe("it beats the attack it exists for", () => {
  const evil = "(a+)+$";
  const bait = "a".repeat(40) + "!";

  test("the pattern is refused", () => {
    expect(refusePattern(evil)).toContain("exponential");
  });

  test("and an accepted pattern on the same input is instant", () => {
    const safe = "^a+!$";
    expect(refusePattern(safe)).toBe(null);
    const started = performance.now();
    expect(new RegExp(safe).test(bait)).toBe(true);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
