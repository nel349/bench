import type { ReactElement, ReactNode } from "react";
import { render as renderBare, type RenderOptions } from "@testing-library/react";
import { createIntl } from "react-intl";
import { LOCALE, MESSAGES, StringsProvider } from "../src/strings/StringsProvider.tsx";
import type { Phrase } from "../src/shared/lib/phrase.ts";
import { NetworkProvider } from "../src/shared/network/NetworkProvider.tsx";
import type { Network } from "../src/shared/network/network.ts";
import { TESTNET } from "./network.ts";

/** The catalog as the page reads it, for a test that checks words outside a component. */
export const intl = createIntl({ locale: LOCALE, messages: MESSAGES });

/** A `Phrase` in words, as `useSay` gives them on the page. */
export const say = (p: Phrase): string => ("text" in p ? p.text : intl.formatMessage({ id: p.id }, p.values));

/**
 * The catalog, strict: a message that is missing, or given the wrong values, throws. On the page it
 * is logged and the raw message is shown, which no test of words on screen would notice.
 */
function Strict({ children }: { readonly children: ReactNode }) {
  return <StringsProvider onError={(error) => { throw error; }}>{children}</StringsProvider>;
}

/** What a component stands in on the page: the catalog, strict, and a network. */
export const onNetwork = (network: Network) =>
  function Page({ children }: { readonly children: ReactNode }) {
    return <Strict><NetworkProvider network={network}>{children}</NetworkProvider></Strict>;
  };

export interface PageOptions extends Omit<RenderOptions, "wrapper"> {
  /** The network the page is on. Testnet, with an owner's wallet, unless a test says otherwise. */
  readonly network?: Network;
}

/**
 * Renders inside the catalog and on a network, as `main.tsx` and `App` do, so a component reads the
 * same words and the same network facts in a test.
 */
export const render = (ui: ReactElement, { network = TESTNET, ...options }: PageOptions = {}) =>
  renderBare(ui, { wrapper: onNetwork(network), ...options });
