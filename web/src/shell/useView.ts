import { useEffect, useState } from "react";

/**
 * Which plate is showing, and what inside it, carried in the URL's hash so a view can be linked to
 * and survives a reload. Views of one rig, not separate pages: the frame stays put and the image
 * inside changes.
 *
 * No hash is the front page. The hash is the view and then its detail: `#exercises/liar` is Liar's
 * own page, `#standings/894767` is the standings with that agent looked up, `#yours/0x…` is one
 * owner's page, and `#connected/0x…` is where the wallet sends an owner back after Connect wallet.
 * A view that ignores detail simply ignores it.
 */
export const VIEWS = ["home", "yours", "exercises", "standings", "gigs", "connected"] as const;
export type View = (typeof VIEWS)[number];

/**
 * The names two views had while the page was set out as the gym's loop: Train, then Rep. An owner
 * read `#rig` in the address bar and could not say what it was. Links were given out under those
 * names, by agents and in people's bookmarks, so each still opens the view it became.
 */
const FORMER: Readonly<Record<string, View>> = { rig: "exercises", ledger: "standings" };

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

/** A hash as text. One that is not valid percent-encoding, like `#%`, is read as it is written rather than thrown on. */
function decoded(hash: string): string {
  try {
    return decodeURIComponent(hash);
  } catch {
    return hash;
  }
}

export function routeOf(hash: string): Route {
  const [first = "", ...rest] = decoded(hash.replace(/^#/, "")).split("/");
  const named = Object.hasOwn(FORMER, first) ? FORMER[first]! : first;
  const known = (VIEWS as readonly string[]).includes(named);
  return { view: known ? (named as View) : "home", detail: known ? rest.filter((p) => p.length > 0) : [] };
}

/**
 * The link a hash should be showing, where it is under a view's former name: `#rig/liar` is
 * `/#exercises/liar`. `null` for one that is already under its present name, or names no view.
 */
export function renamed(hash: string): string | null {
  const [first = ""] = decoded(hash.replace(/^#/, "")).split("/");
  if (!Object.hasOwn(FORMER, first)) return null;
  const { view, detail } = routeOf(hash);
  return viewHref(view, ...detail);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => routeOf(window.location.hash));
  useEffect(() => {
    const changed = () => {
      // A link under a former name opens, and then the address bar is put right, in place, so it is
      // the present name that gets copied and bookmarked from here on. Back still goes where it did.
      const now = renamed(window.location.hash);
      if (now !== null) window.history.replaceState(window.history.state, "", now);
      setRoute(routeOf(window.location.hash));
    };
    changed();
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  return route;
}

export function useView(): View {
  return useRoute().view;
}
