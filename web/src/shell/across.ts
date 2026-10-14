import { PATHS } from "../../../src/shared/paths.ts";
import { routeOf, viewHref, type View } from "./useView.ts";

/** Views that mean the same on either network. The rest are about one wallet or one answer from it. */
const CARRIED: readonly View[] = ["exercises", "standings", "gigs", "yours"];

/**
 * The same page on the other network's gym.
 *
 * The page and the view are kept: somebody reading the standings lands on the other standings.
 * What follows the view is dropped, and so is anything after a `?`: an agent's number, a wallet's
 * address and an exercise's leaderboard belong to one network, and carried across they would name
 * somebody else or nobody.
 */
export function acrossHref(other: string, here: Pick<Location, "pathname" | "hash">): string {
  if (here.pathname.startsWith(PATHS.fund)) return `${other}${PATHS.fund}`;
  const { view } = routeOf(here.hash);
  return CARRIED.includes(view) ? `${other}${viewHref(view)}` : `${other}${PATHS.index}`;
}
