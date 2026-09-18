/**
 * Every path this server answers, in one place.
 *
 * The page and the router both read from here, so a path cannot drift between the link and the
 * route that serves it — which is the failure mode of writing `/feed` in two files and renaming one.
 */
export const PATHS = {
  index: "/",
  problems: "/problems",
  attempts: "/attempts",
  agents: "/agents",
  leaderboard: "/leaderboard",
  /** Recent runs across every problem, refusals included. What the page polls. */
  feed: "/feed",
  style: "/bench.css",
  script: "/bench.js",
} as const;

/** How many runs the feed carries. Enough to show a session, small enough to poll often. */
export const FEED_LIMIT = 40;
