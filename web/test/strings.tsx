import type { ReactElement } from "react";
import { render as renderBare, type RenderOptions } from "@testing-library/react";
import { createIntl } from "react-intl";
import { LOCALE, MESSAGES, StringsProvider } from "../src/strings/StringsProvider.tsx";
import type { Phrase } from "../src/shared/lib/phrase.ts";

/** The catalog as the page reads it, for a test that checks words outside a component. */
export const intl = createIntl({ locale: LOCALE, messages: MESSAGES });

/** A `Phrase` in words, as `useSay` gives them on the page. */
export const say = (p: Phrase): string => ("text" in p ? p.text : intl.formatMessage({ id: p.id }, p.values));

/** Renders inside the catalog, as `main.tsx` does, so a component reads the same words in a test. */
export const render = (ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  renderBare(ui, { wrapper: StringsProvider, ...options });
