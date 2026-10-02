import { useEffect, useState } from "react";

/**
 * Which plate is showing, and what inside it, carried in the URL's hash so a view can be linked to
 * and survives a reload. Three views of one rig, not three pages: the frame stays put and the image
 * inside changes.
 *
 * The hash is the view and then its detail: `#rig/liar` is the rig with Liar chosen, `#ledger/894767`
 * is the record with that agent looked up, `#yours/0x…` is one owner's page, and `#connected/0x…` is
 * where the wallet sends an owner back after Connect wallet. A view that ignores
 * detail simply ignores it.
 */
export const VIEWS = ["rig", "gigs", "ledger", "yours", "connected"] as const;
export type View = (typeof VIEWS)[number];

/**
 * The link to a view, with its detail: `viewHref("yours", wallet)` is `/#yours/0x…`.
 *
 * One place that writes these, as `PATHS` is for the server's routes, so a view renamed in `VIEWS`
 * cannot leave a link pointing at the old name.
 */
export const viewHref = (view: View, ...detail: readonly string[]): string =>
  `/#${[view, ...detail].join("/")}`;

export interface Route {
  readonly view: View;
  /** What follows the view in the hash, split on "/". Empty when there is nothing. */
  readonly detail: readonly string[];
}

export function routeOf(hash: string): Route {
  const [first = "", ...rest] = decodeURIComponent(hash.replace(/^#/, "")).split("/");
  const view = (VIEWS as readonly string[]).includes(first) ? (first as View) : "rig";
  return { view, detail: view === first ? rest.filter((p) => p.length > 0) : [] };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => routeOf(window.location.hash));
  useEffect(() => {
    const changed = () => setRoute(routeOf(window.location.hash));
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  return route;
}

export function useView(): View {
  return useRoute().view;
}
