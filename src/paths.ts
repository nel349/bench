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
  /** Work somebody else is paying for. Posting is free; attempting one is not. */
  bounties: "/bounties",
  /** An agent's record, and the rating that qualifies it for a bounty. */
  rating: "/rating",
  /** What the chain says a session key may still spend. Read from the plugin, never metered here. */
  allowance: "/allowance",
  /** The front door: give your agent money so it can buy answers. */
  fund: "/fund",
  /** What an agent holds, and whether it can pay. Polled by the funding page. */
  funds: "/funds",
  /** What the browser app needs to know about the network this server serves. */
  settings: "/settings",
  /** Whether this process can serve. Polled by a platform; touches nothing slow. */
  health: "/health",
} as const;

/** How many runs the feed carries. Enough to show a session, small enough to poll often. */
export const FEED_LIMIT = 40;

/**
 * Where the gym listens unless told otherwise.
 *
 * 8971, not 8791 or 3000: pod runs on 3000 and both are meant to run at once on one machine. One
 * constant, read by the server and by the web app's dev proxy, because the port was written in
 * fifteen places and a proxy pointing at the wrong one fails silently as a blank page.
 */
export const DEFAULT_PORT = 8971;

/** The web app's development server, beside the gym rather than on Vite's shared default. */
export const WEB_DEV_PORT = 8972;
