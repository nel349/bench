import { MAX_DEPTH, MAX_NODES, type Check } from "./check.ts";
import { refusePattern } from "./regex.ts";

/**
 * Turning a poster's JSON into a checker, or refusing it.
 *
 * This runs when a bounty is **posted**, not when an answer is graded. The difference matters: a
 * malformed checker becomes an error message for the person who wrote it, in front of them, instead
 * of a 500 halfway through grading a stranger's submission — at which point the money is committed
 * and nobody can tell whether the answer was wrong or the checker was.
 *
 * So everything is validated up front and `run` is total: given a parsed `Check` and any JSON value,
 * it returns a verdict and cannot throw.
 */
export type Parsed =
  | { readonly ok: true; readonly check: Check }
  | { readonly ok: false; readonly problem: string; readonly at: string };

const bad = (problem: string, at: string): Parsed => ({ ok: false, problem, at });

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** JSON, and only JSON. A checker that held a function or a Date would not survive a round trip. */
function plainJson(v: unknown, depth: number): boolean {
  if (depth > MAX_DEPTH) return false;
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => plainJson(x, depth + 1));
  if (isObj(v)) return Object.values(v).every((x) => plainJson(x, depth + 1));
  return false;
}

export function parseCheck(spec: unknown): Parsed {
  let nodes = 0;

  function walk(v: unknown, depth: number, at: string): Parsed {
    if (depth > MAX_DEPTH) return bad(`nested deeper than ${MAX_DEPTH}`, at);
    if (++nodes > MAX_NODES) return bad(`more than ${MAX_NODES} assertions`, at);
    if (!isObj(v)) return bad("expected an object with a kind", at);

    const kind = v["kind"];
    if (typeof kind !== "string") return bad("missing kind", at);

    const value = (name: string): Parsed | null =>
      plainJson(v[name], depth) ? null : bad(`${name} must be plain JSON`, at);

    const sub = (name: string): Parsed => walk(v[name], depth + 1, `${at}.${name}`);

    switch (kind) {
      case "equals":
        return value("value") ?? { ok: true, check: { kind, value: v["value"] } };

      case "oneOf": {
        const vals = v["values"];
        if (!Array.isArray(vals) || vals.length === 0) return bad("values must be a non-empty array", at);
        return value("values") ?? { ok: true, check: { kind, values: vals } };
      }

      case "sameElements": {
        const vals = v["values"];
        if (!Array.isArray(vals)) return bad("values must be an array", at);
        return value("values") ?? { ok: true, check: { kind, values: vals } };
      }

      case "closeTo": {
        if (!isFiniteNumber(v["value"])) return bad("value must be a finite number", at);
        if (!isFiniteNumber(v["within"]) || v["within"] < 0) return bad("within must be a number ≥ 0", at);
        return { ok: true, check: { kind, value: v["value"], within: v["within"] } };
      }

      case "between": {
        if (!isFiniteNumber(v["min"]) || !isFiniteNumber(v["max"])) return bad("min and max must be finite numbers", at);
        if (v["min"] > v["max"]) return bad("min is greater than max, so nothing could pass", at);
        return { ok: true, check: { kind, min: v["min"], max: v["max"] } };
      }

      case "matches": {
        const pattern = v["pattern"];
        const flags = v["flags"] ?? "";
        if (typeof pattern !== "string") return bad("pattern must be a string", at);
        if (typeof flags !== "string") return bad("flags must be a string", at);
        const refused = refusePattern(pattern, flags);
        if (refused) return bad(refused, at);
        return { ok: true, check: { kind, pattern, ...(flags ? { flags } : {}) } };
      }

      case "length": {
        const min = v["min"], max = v["max"];
        const intOrAbsent = (x: unknown) => x === undefined || (Number.isInteger(x) && (x as number) >= 0);
        if (!intOrAbsent(min) || !intOrAbsent(max)) return bad("min and max must be whole numbers ≥ 0", at);
        if (min === undefined && max === undefined) return bad("length needs a min or a max", at);
        if (typeof min === "number" && typeof max === "number" && min > max) {
          return bad("min is greater than max, so nothing could pass", at);
        }
        return { ok: true, check: {
          kind, ...(min === undefined ? {} : { min: min as number }),
          ...(max === undefined ? {} : { max: max as number }),
        } };
      }

      case "every": case "not": {
        const inner = sub("check");
        return inner.ok ? { ok: true, check: { kind, check: inner.check } } : inner;
      }

      case "at": {
        if (!Number.isInteger(v["index"]) || (v["index"] as number) < 0) {
          return bad("index must be a whole number ≥ 0", at);
        }
        const inner = sub("check");
        return inner.ok ? { ok: true, check: { kind, index: v["index"] as number, check: inner.check } } : inner;
      }

      case "field": {
        const name = v["name"];
        if (typeof name !== "string" || name.length === 0) return bad("name must be a non-empty string", at);
        // `__proto__` as a *key* is fine; it is read with hasOwn, never by property access.
        const inner = walk(v["check"], depth + 1, `${at}.${name}`);
        return inner.ok ? { ok: true, check: { kind, name, check: inner.check } } : inner;
      }

      case "allOf": case "anyOf": {
        const list = v["checks"];
        if (!Array.isArray(list) || list.length === 0) return bad("checks must be a non-empty array", at);
        const out: Check[] = [];
        for (let i = 0; i < list.length; i++) {
          const inner = walk(list[i], depth + 1, `${at}.${kind}[${i}]`);
          if (!inner.ok) return inner;
          out.push(inner.check);
        }
        return { ok: true, check: { kind, checks: out } };
      }

      default:
        return bad(`unknown kind: ${kind}`, at);
    }
  }

  return walk(spec, 0, "$");
}
