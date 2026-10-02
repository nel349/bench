import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { createIntl } from "react-intl";
import { LOCALE, MESSAGES, type MessageId } from "../src/strings/StringsProvider.tsx";
import { STEPS } from "../src/setup/steps.ts";

const SRC = join(__dirname, "../src");
const IDS = Object.keys(MESSAGES) as MessageId[];

/** Every source file of the page, read once. */
const source = (function read(dir: string): string {
  return readdirSync(dir).map((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return read(path);
    return /\.(ts|tsx)$/.test(name) ? readFileSync(path, "utf8") : "";
  }).join("\n");
})(SRC);

/**
 * Ids the page builds from a value rather than writes out: a step's title from its number, a level's
 * name from the level. Listed from the same values the page builds them from, so a new step or level
 * without its words fails here.
 */
const BUILT: readonly string[] = [
  ...STEPS.flatMap((s) => [`step${s.n}.title`, `step${s.n}.detail`, `step.where.${s.where}`]),
  ...["easy", "medium", "hard"].map((level) => `level.${level}`),
  ...["up", "down", "left", "right"].map((side) => `demo.side.${side}`),
  ...["hit", "reflect", "refused"].map((kind) => `demo.${kind}`),
];

/** The parts of a parsed message this test reads: an argument's name and kind, and what nests inside. */
interface Element {
  readonly type: number;
  readonly value?: string;
  readonly options?: Readonly<Record<string, { readonly value: readonly Element[] }>>;
  readonly children?: readonly Element[];
}

/** ICU's element kinds, as the parser numbers them. */
const KIND = { argument: 1, number: 2, select: 5, plural: 6, tag: 8 } as const;

/** A value for every argument a message asks for: a number for a plural, a word for a select, a function for a tag. */
type Value = string | number | ((chunks: readonly ReactNode[]) => ReactNode);
function valuesFor(ast: readonly Element[], into: Record<string, Value> = {}): Record<string, Value> {
  for (const el of ast) {
    if (el.type === KIND.plural || el.type === KIND.number) into[el.value!] = 2;
    else if (el.type === KIND.select) into[el.value!] = Object.keys(el.options!)[0]!;
    else if (el.type === KIND.argument) into[el.value!] = "x";
    else if (el.type === KIND.tag) into[el.value!] = (chunks) => chunks;
    for (const option of Object.values(el.options ?? {})) valuesFor(option.value, into);
    valuesFor(el.children ?? [], into);
  }
  return into;
}

describe("the catalog", () => {
  test("every message is used by the page", () => {
    const unused = IDS.filter((id) => !source.includes(`"${id}"`) && !BUILT.includes(id));
    expect(unused).toEqual([]);
  });

  test("every id the page builds is in the catalog", () => {
    expect(BUILT.filter((id) => !(id in MESSAGES))).toEqual([]);
  });

  test("every message is valid ICU, and formats with the values it asks for", () => {
    const errors: string[] = [];
    const intl = createIntl({ locale: LOCALE, messages: MESSAGES, onError: (e) => errors.push(e.message) });
    for (const id of IDS) {
      // Parsing is where a malformed message throws.
      const ast: readonly Element[] = intl.formatters.getMessageFormat(MESSAGES[id], LOCALE).getAst();
      intl.formatMessage({ id }, valuesFor(ast));
    }
    expect(errors).toEqual([]);
  });

  test("no em dashes", () => {
    expect(IDS.filter((id) => MESSAGES[id].includes("—"))).toEqual([]);
  });

  /**
   * The words a newcomer could not read, from the words spike: the old game's (ICE, breach, flatline),
   * the plumbing's (escrow, deposit) and the ones that meant something else (probe, par, rank, bounty,
   * load, board). Each has one word in its place.
   */
  test("none of the retired words", () => {
    const RETIRED = /\b(probes?|breach\w*|flatlin\w*|bount(?:y|ies)|escrow|par|rank\w*|deposit\w*|load|board|yours)\b|\bICE\b/i;
    expect(IDS.filter((id) => RETIRED.test(MESSAGES[id])).map((id) => `${id}: ${MESSAGES[id]}`)).toEqual([]);
  });
});
