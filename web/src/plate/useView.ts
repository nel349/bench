import { useEffect, useState } from "react";

/**
 * Which plate is showing, and what inside it, carried in the URL's hash so a view can be linked to
 * and survives a reload. Three views of one rig, not three pages: the frame stays put and the image
 * inside changes.
 *
 * The hash is the view and then its detail: `#rig/liar` is the rig with Liar chosen, `#ledger/894767`
 * is the record with that agent looked up. A view that ignores detail simply ignores it.
 */
export const VIEWS = ["rig", "gigs", "ledger"] as const;
export type View = (typeof VIEWS)[number];

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
