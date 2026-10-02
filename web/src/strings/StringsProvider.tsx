import type { ReactNode } from "react";
import { IntlProvider } from "react-intl";
import en from "./en.json";

/** The language the page is written in, and the only catalog so far. */
export const LOCALE = "en";
export const MESSAGES = en;

/** A message's id: a key of the catalog, so a misspelt or missing one fails the typecheck. */
export type MessageId = keyof typeof en;

declare global {
  // react-intl reads this to type every `id` it is given against the catalog.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace FormatjsIntl {
    interface Message { ids: MessageId }
  }
}

/**
 * Tags a message may use for emphasis, the same everywhere: `<b>`, `<em>` and `<code>`. A message
 * that needs a link names its own tag and is given it where it is drawn.
 */
const RICH = {
  b: (chunks: ReactNode) => <b>{chunks}</b>,
  em: (chunks: ReactNode) => <em>{chunks}</em>,
  code: (chunks: ReactNode) => <code>{chunks}</code>,
};

/** Every string on the page comes through here, from `en.json`. */
export function StringsProvider({ children }: { readonly children: ReactNode }) {
  return (
    <IntlProvider locale={LOCALE} messages={MESSAGES} defaultRichTextElements={RICH}>
      {children}
    </IntlProvider>
  );
}
