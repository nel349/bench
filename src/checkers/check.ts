/**
 * Checkers that are data, not code.
 *
 * A bounty poster has to say what counts as a correct answer, and the obvious way to let them is to
 * let them ship a function. That is the road that ends in containers, a registry, a cluster and an
 * SSH gateway — the infrastructure that sank the one team who built this properly. Nothing in this
 * file executes anything a poster wrote, because there is nothing here that could.
 *
 * A checker is a tree of assertions. It is parsed once when the bounty is posted — so a malformed
 * one is rejected by the person who wrote it, not discovered while grading somebody's submission —
 * and then run as a pure, total function over the answer.
 *
 * The expected values inside a checker are **secret**. They are what the agent is being paid to
 * work out, so nothing here ever puts one in a failure message.
 */

/** How deep a checker, or an answer, may nest. Deeper than this is a stack overflow, not a puzzle. */
export const MAX_DEPTH = 24;
/** How many assertions one checker may hold, counted across the whole tree. */
export const MAX_NODES = 512;
/** The longest string `matches` will look at, and the longest pattern it will accept. */
export const MAX_SUBJECT = 8_192;
export const MAX_PATTERN = 256;

export type Check =
  /** Deep equality against a hidden expected value. */
  | { readonly kind: "equals"; readonly value: unknown }
  | { readonly kind: "oneOf"; readonly values: readonly unknown[] }
  /** Numeric, with an absolute tolerance. `0.1 + 0.2` is not `0.3` and a bounty should not hinge on it. */
  | { readonly kind: "closeTo"; readonly value: number; readonly within: number }
  | { readonly kind: "between"; readonly min: number; readonly max: number }
  | { readonly kind: "matches"; readonly pattern: string; readonly flags?: string }
  | { readonly kind: "length"; readonly min?: number; readonly max?: number }
  /** Every element of an array must pass. An empty array passes, which is usually what you want. */
  | { readonly kind: "every"; readonly check: Check }
  | { readonly kind: "at"; readonly index: number; readonly check: Check }
  /** A named field of an object. Missing is a failure, not an error. */
  | { readonly kind: "field"; readonly name: string; readonly check: Check }
  | { readonly kind: "allOf"; readonly checks: readonly Check[] }
  | { readonly kind: "anyOf"; readonly checks: readonly Check[] }
  | { readonly kind: "not"; readonly check: Check }
  /** The answer is an unordered collection: same elements, any order, duplicates counted. */
  | { readonly kind: "sameElements"; readonly values: readonly unknown[] };

export type Verdict =
  | { readonly pass: true }
  /** Why it failed, in terms an agent can act on — and never quoting the expected value. */
  | { readonly pass: false; readonly because: string; readonly at: string };
