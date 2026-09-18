import { expect, test, describe } from "bun:test";
import { parseCheck } from "./parse.ts";
import { run } from "./run.ts";
import { MAX_DEPTH, MAX_NODES, MAX_SUBJECT, type Check } from "./check.ts";

/** Parse a spec that is expected to be good, so a test about running is not also a test about parsing. */
const good = (spec: unknown): Check => {
  const p = parseCheck(spec);
  if (!p.ok) throw new Error(`spec was refused: ${p.problem} at ${p.at}`);
  return p.check;
};
const refused = (spec: unknown): string => {
  const p = parseCheck(spec);
  if (p.ok) throw new Error("expected the spec to be refused");
  return p.problem;
};
const verdict = (spec: unknown, answer: unknown) => run(good(spec), answer);
const passes = (spec: unknown, answer: unknown) => expect(verdict(spec, answer).pass).toBe(true);
const fails = (spec: unknown, answer: unknown) => expect(verdict(spec, answer).pass).toBe(false);

describe("equality", () => {
  test("deep, and key order does not count", () => {
    passes({ kind: "equals", value: { a: 1, b: [2, 3] } }, { b: [2, 3], a: 1 });
  });
  test("an extra field is a failure", () => {
    fails({ kind: "equals", value: { a: 1 } }, { a: 1, b: 2 });
  });
  test("array order does count", () => {
    fails({ kind: "equals", value: [1, 2] }, [2, 1]);
  });
  test("a number is not its string", () => {
    fails({ kind: "equals", value: 42 }, "42");
  });
  test("-0 is not 0, because an agent that divided by a negative should not slip through", () => {
    fails({ kind: "equals", value: 0 }, -0);
  });
  test("null is not undefined-shaped emptiness", () => {
    fails({ kind: "equals", value: null }, {});
  });
});

describe("unordered answers", () => {
  test("same elements in any order", () => {
    passes({ kind: "sameElements", values: [3, 1, 2] }, [1, 2, 3]);
  });
  test("duplicates are counted, not collapsed into a set", () => {
    fails({ kind: "sameElements", values: [1, 1, 2] }, [1, 2, 2]);
  });
  test("objects compare deeply inside the bag", () => {
    passes({ kind: "sameElements", values: [{ x: 1 }, { y: 2 }] }, [{ y: 2 }, { x: 1 }]);
  });
});

describe("numbers", () => {
  test("a tolerance, because 0.1 + 0.2 is not 0.3", () => {
    passes({ kind: "closeTo", value: 0.3, within: 1e-9 }, 0.1 + 0.2);
  });
  test("outside the tolerance fails", () => {
    fails({ kind: "closeTo", value: 0.3, within: 1e-9 }, 0.31);
  });
  test("a range", () => {
    passes({ kind: "between", min: 1, max: 10 }, 10);
    fails({ kind: "between", min: 1, max: 10 }, 10.5);
  });
  test("a string that looks numeric is still a string", () => {
    fails({ kind: "between", min: 1, max: 10 }, "5");
  });
});

describe("structure", () => {
  test("a field, checked", () => {
    passes({ kind: "field", name: "total", check: { kind: "equals", value: 7 } }, { total: 7 });
  });
  test("a missing field fails rather than throwing", () => {
    fails({ kind: "field", name: "total", check: { kind: "equals", value: 7 } }, {});
  });
  test("every element", () => {
    passes({ kind: "every", check: { kind: "between", min: 0, max: 1 } }, [0, 0.5, 1]);
    fails({ kind: "every", check: { kind: "between", min: 0, max: 1 } }, [0, 2]);
  });
  test("an empty array passes `every`, which is what an agent expects", () => {
    passes({ kind: "every", check: { kind: "equals", value: 1 } }, []);
  });
  test("an index past the end fails rather than reading undefined", () => {
    fails({ kind: "at", index: 5, check: { kind: "equals", value: 1 } }, [1, 2]);
  });
  test("length bounds", () => {
    passes({ kind: "length", min: 2, max: 4 }, "abc");
    passes({ kind: "length", min: 2 }, [1, 2, 3]);
    fails({ kind: "length", max: 2 }, [1, 2, 3]);
  });
});

describe("combinators", () => {
  const spec = {
    kind: "allOf",
    checks: [
      { kind: "field", name: "id", check: { kind: "matches", pattern: "^[a-f0-9]{8}$" } },
      { kind: "field", name: "score", check: { kind: "between", min: 0, max: 100 } },
    ],
  };
  test("allOf needs both", () => {
    passes(spec, { id: "deadbeef", score: 99 });
    fails(spec, { id: "nope", score: 99 });
    fails(spec, { id: "deadbeef", score: 101 });
  });
  test("anyOf needs one", () => {
    const s = { kind: "anyOf", checks: [{ kind: "equals", value: "yes" }, { kind: "equals", value: "no" }] };
    passes(s, "no");
    fails(s, "maybe");
  });
  test("not inverts", () => {
    passes({ kind: "not", check: { kind: "equals", value: 1 } }, 2);
    fails({ kind: "not", check: { kind: "equals", value: 1 } }, 1);
  });
});

/**
 * The expected value is the thing the agent is being paid to find. A failure message that quoted it
 * would sell the bounty for the price of one wrong submission.
 */
describe("a failure never gives the answer away", () => {
  test("equals does not quote what was expected", () => {
    const v = verdict({ kind: "equals", value: "s3cr3t-answer" }, "wrong");
    expect(v.pass).toBe(false);
    if (v.pass) return;
    expect(v.because).not.toContain("s3cr3t");
  });

  test("oneOf does not list the accepted values", () => {
    const v = verdict({ kind: "oneOf", values: ["alpha", "beta"] }, "gamma");
    if (v.pass) return;
    expect(v.because).not.toContain("alpha");
    expect(v.because).not.toContain("beta");
  });

  test("anyOf does not say which branch came closest", () => {
    const v = verdict({ kind: "anyOf", checks: [{ kind: "equals", value: "alpha" }] }, "x");
    if (v.pass) return;
    expect(v.because).not.toContain("alpha");
  });

  test("closeTo does not reveal the target", () => {
    const v = verdict({ kind: "closeTo", value: 1234.5, within: 0.1 }, 0);
    if (v.pass) return;
    expect(v.because).not.toContain("1234");
  });

  test("matches does not echo the pattern", () => {
    const v = verdict({ kind: "matches", pattern: "^SECRETPREFIX" }, "no");
    if (v.pass) return;
    expect(v.because).not.toContain("SECRET");
  });

  test("but it does say where, so a wrong shape is still debuggable", () => {
    const v = run(good({ kind: "field", name: "items", check: { kind: "every", check: { kind: "equals", value: 1 } } }),
      { items: [1, 2] });
    if (v.pass) return;
    expect(v.at).toBe("$.items[1]");
  });
});

describe("specs a poster gets wrong", () => {
  test("an unknown kind is named", () => expect(refused({ kind: "eq", value: 1 })).toContain("unknown kind"));
  test("a missing kind", () => expect(refused({ value: 1 })).toContain("missing kind"));
  test("not an object at all", () => expect(refused("equals")).toContain("kind"));
  test("an impossible range is refused at post time", () =>
    expect(refused({ kind: "between", min: 10, max: 1 })).toContain("nothing could pass"));
  test("an impossible length is refused at post time", () =>
    expect(refused({ kind: "length", min: 5, max: 2 })).toContain("nothing could pass"));
  test("a length with neither bound says nothing", () =>
    expect(refused({ kind: "length" })).toContain("needs a min or a max"));
  test("an empty oneOf could never pass", () =>
    expect(refused({ kind: "oneOf", values: [] })).toContain("non-empty"));
  test("NaN is not a value JSON can carry", () =>
    expect(refused({ kind: "closeTo", value: 0 / 0, within: 1 })).toContain("finite"));
  test("a negative tolerance", () =>
    expect(refused({ kind: "closeTo", value: 1, within: -1 })).toContain("within"));
  test("the error says where in the tree", () => {
    const p = parseCheck({ kind: "allOf", checks: [{ kind: "equals", value: 1 }, { kind: "nope" }] });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.at).toContain("allOf[1]");
  });
});

describe("limits that stop a spec from being a weapon", () => {
  const nest = (n: number): unknown => {
    let c: unknown = { kind: "equals", value: 1 };
    for (let i = 0; i < n; i++) c = { kind: "not", check: c };
    return c;
  };

  test("a checker deeper than the cap is refused, not stack-overflowed", () => {
    expect(refused(nest(MAX_DEPTH + 5))).toContain("deeper");
  });

  test("one just inside the cap is fine", () => {
    expect(parseCheck(nest(MAX_DEPTH - 2)).ok).toBe(true);
  });

  test("more assertions than the cap is refused", () => {
    const many = { kind: "allOf", checks: Array.from({ length: MAX_NODES + 1 }, () => ({ kind: "equals", value: 1 })) };
    expect(refused(many)).toContain("assertions");
  });

  test("a catastrophic pattern is refused when the bounty is posted", () => {
    expect(refused({ kind: "matches", pattern: "(a+)+$" })).toContain("exponential");
  });

  test("a subject longer than the cap fails instead of being matched", () => {
    fails({ kind: "matches", pattern: "^a+$" }, "a".repeat(MAX_SUBJECT + 1));
  });

  test("a deeply nested answer fails rather than overflowing the stack", () => {
    let deep: unknown = 1;
    for (let i = 0; i < 2000; i++) deep = [deep];
    const v = run(good({ kind: "every", check: { kind: "equals", value: 1 } }), deep);
    expect(v.pass).toBe(false);
  });
});

/**
 * Nothing here executes anything. These are the properties that let this ship without containers.
 */
describe("what a checker cannot do", () => {
  test("a function in a spec is refused, not called", () => {
    let called = false;
    expect(parseCheck({ kind: "equals", value: () => { called = true; } }).ok).toBe(false);
    expect(called).toBe(false);
  });

  test("a function in an answer never runs; it simply is not equal to anything", () => {
    let called = false;
    fails({ kind: "equals", value: 1 }, () => { called = true; });
    expect(called).toBe(false);
  });

  test("a __proto__ key is data, and does not reach Object.prototype", () => {
    const answer = JSON.parse('{"__proto__": {"polluted": true}}');
    passes({ kind: "field", name: "__proto__", check: { kind: "equals", value: { polluted: true } } }, answer);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  test("a constructor key is just a key", () => {
    const answer = JSON.parse('{"constructor": 1}');
    passes({ kind: "field", name: "constructor", check: { kind: "equals", value: 1 } }, answer);
  });

  test("running the same checker twice gives the same verdict", () => {
    const c = good({ kind: "matches", pattern: "^a+$" });
    expect(run(c, "aaa").pass).toBe(true);
    expect(run(c, "aaa").pass).toBe(true); // no lastIndex carried over
  });
});
