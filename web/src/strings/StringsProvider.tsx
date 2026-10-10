import { useEffect, type ReactNode } from "react";
import { IntlProvider, useIntl } from "react-intl";
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

/**
 * The tab's title, from the catalog like every other word. `index.html` carries the same words for
 * the moment before the page runs.
 */
function TabTitle() {
  const title = useIntl().formatMessage({ id: "app.title" });
  useEffect(() => { document.title = title; }, [title]);
  return null;
}

export interface StringsProviderProps {
  readonly children: ReactNode;
  /**
   * What to do with a message that cannot be said: one missing, or given the wrong values. Left out,
   * it is logged and the page shows the raw message; the tests throw, so such a page never passes.
   */
  readonly onError?: (error: Error) => void;
}

/** Every string on the page comes through here, from `en.json`. */
export function StringsProvider({ children, onError }: StringsProviderProps) {
  return (
    <IntlProvider locale={LOCALE} messages={MESSAGES} defaultRichTextElements={RICH} {...(onError ? { onError } : {})}>
      <TabTitle />
      {children}
    </IntlProvider>
  );
}
