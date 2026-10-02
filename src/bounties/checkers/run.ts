import { MAX_DEPTH, MAX_SUBJECT, type Check, type Verdict } from "./check.ts";

/**
 * Running a parsed checker against an answer.
 *
 * Total by construction: every branch returns a verdict, and the only things that could throw —
 * a bad pattern, a cyclic value, a tree deep enough to blow the stack — were refused at parse time
 * or are bounded here.
 *
 * **A failure message never quotes the expected value.** The expected value is the answer, and the
 * agent is being paid to work it out; a message saying "expected 41, got 42" hands over the bounty
 * for the price of one wrong submission. So failures say what was wrong with the *submission* —
 * its shape, its type, which field — and nothing about what would have been right.
 */
const pass: Verdict = { pass: true };
const fail = (because: string, at: string): Verdict => ({ pass: false, because, at });

const typeName = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "an array" : `a ${typeof v}`;

/** Own enumerable keys only, so a `__proto__` key in parsed JSON is data and never a prototype. */
const keys = (o: object): string[] => Object.keys(o);

/**
 * Deep equality over JSON.
 *
 * `Object.is` rather than `===` so `NaN` equals itself, which matters because a checker written as
 * `equals: 0` should not accept `-0` from an agent that divided by a negative.
 */
function same(a: unknown, b: unknown, depth: number): boolean {
  if (depth > MAX_DEPTH) return false;
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => same(x, b[i], depth + 1));
  }

  if (typeof a === "object" && typeof b === "object") {
    const ka = keys(a as object), kb = keys(b as object);
    if (ka.length !== kb.length) return false;
    // Key order is not meaningful in JSON, so it is compared as a set.
    return ka.every((k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth + 1));
  }
  return false;
}

/** Same elements, any order, duplicates counted. Quadratic, and bounded by the node cap. */
function sameBag(want: readonly unknown[], got: readonly unknown[]): boolean {
  if (want.length !== got.length) return false;
  const used = new Array<boolean>(got.length).fill(false);
  for (const w of want) {
    const i = got.findIndex((g, j) => !used[j] && same(w, g, 0));
    if (i === -1) return false;
    used[i] = true;
  }
  return true;
}

export function run(check: Check, answer: unknown, at = "$"): Verdict {
  return go(check, answer, at, 0);
}

function go(check: Check, v: unknown, at: string, depth: number): Verdict {
  if (depth > MAX_DEPTH) return fail("the answer nests too deeply", at);

  switch (check.kind) {
    case "equals":
      return same(check.value, v, 0) ? pass : fail(`${typeName(v)} that is not the expected value`, at);

    case "oneOf":
      return check.values.some((x) => same(x, v, 0)) ? pass : fail("not one of the accepted values", at);

    case "sameElements":
      if (!Array.isArray(v)) return fail(`expected an array, got ${typeName(v)}`, at);
      return sameBag(check.values, v)
        ? pass
        : fail(v.length === check.values.length
            ? "an array of the right length with the wrong elements"
            : `an array of ${v.length} elements, expected ${check.values.length}`, at);

    case "closeTo":
      if (typeof v !== "number" || !Number.isFinite(v)) return fail(`expected a number, got ${typeName(v)}`, at);
      return Math.abs(v - check.value) <= check.within ? pass : fail("a number outside the tolerance", at);

    case "between":
      if (typeof v !== "number" || !Number.isFinite(v)) return fail(`expected a number, got ${typeName(v)}`, at);
      return v >= check.min && v <= check.max
        ? pass
        : fail(`a number outside ${check.min}…${check.max}`, at); // a stated range is not a secret

    case "matches": {
      if (typeof v !== "string") return fail(`expected a string, got ${typeName(v)}`, at);
      if (v.length > MAX_SUBJECT) return fail(`a string longer than ${MAX_SUBJECT} characters`, at);
      // Built here rather than kept on the check, so no `lastIndex` survives between runs.
      return new RegExp(check.pattern, check.flags ?? "").test(v) ? pass : fail("a string that does not match", at);
    }

    case "length": {
      const n = typeof v === "string" || Array.isArray(v) ? v.length : null;
      if (n === null) return fail(`expected a string or array, got ${typeName(v)}`, at);
      if (check.min !== undefined && n < check.min) return fail(`${n} long, expected at least ${check.min}`, at);
      if (check.max !== undefined && n > check.max) return fail(`${n} long, expected at most ${check.max}`, at);
      return pass;
    }

    case "every": {
      if (!Array.isArray(v)) return fail(`expected an array, got ${typeName(v)}`, at);
      for (let i = 0; i < v.length; i++) {
        const r = go(check.check, v[i], `${at}[${i}]`, depth + 1);
        if (!r.pass) return r;
      }
      return pass;
    }

    case "at": {
      if (!Array.isArray(v)) return fail(`expected an array, got ${typeName(v)}`, at);
      if (check.index >= v.length) return fail(`only ${v.length} elements, needed index ${check.index}`, at);
      return go(check.check, v[check.index], `${at}[${check.index}]`, depth + 1);
    }

    case "field": {
      if (typeof v !== "object" || v === null || Array.isArray(v)) {
        return fail(`expected an object, got ${typeName(v)}`, at);
      }
      if (!Object.prototype.hasOwnProperty.call(v, check.name)) {
        return fail(`no field ${check.name}`, at); // the field name is the poster's, not the answer
      }
      return go(check.check, (v as Record<string, unknown>)[check.name], `${at}.${check.name}`, depth + 1);
    }

    case "allOf": {
      for (const c of check.checks) {
        const r = go(c, v, at, depth + 1);
        if (!r.pass) return r;
      }
      return pass;
    }

    case "anyOf": {
      for (const c of check.checks) if (go(c, v, at, depth + 1).pass) return pass;
      // Which branch failed is not said: between them they describe the expected answer.
      return fail("none of the accepted forms matched", at);
    }

    case "not":
      return go(check.check, v, at, depth + 1).pass ? fail("matched something excluded", at) : pass;
  }
}
