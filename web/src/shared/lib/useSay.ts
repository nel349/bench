import { useCallback } from "react";
import { useIntl } from "react-intl";
import type { Phrase } from "./phrase.ts";

/** Turns a `Phrase` into words in the page's language. */
export function useSay(): (p: Phrase) => string {
  const intl = useIntl();
  return useCallback((p: Phrase) => ("text" in p ? p.text : intl.formatMessage({ id: p.id }, p.values)), [intl]);
}
