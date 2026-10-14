/**
 * The path an owner takes to let their agent train here, in five steps.
 *
 * The steps and their order are the ones the arc-mandate connector tells an agent and the maze
 * prints, so a person who meets them in the wallet, from their agent and on this page reads one path.
 * Those are separate programs and cannot import this. One title differs for now: step 1 here is
 * "Open the wallet", which is what it is, and the connector still says "Get the app" for a web page
 * with nothing to install. When the connector is corrected the two read the same again.
 *
 * The order is real rather than presentation: the wallet and the connected agent both come before
 * the grant, because a grant needs money behind it and an agent to grant to, and the grant comes
 * before the agent is told to start.
 */
export interface Step {
  /** Which step, from 1: its title and detail are `step<n>.title` and `step<n>.detail` in the catalog. */
  readonly n: 1 | 2 | 3 | 4 | 5;
  /** Which device the person is holding for this step. */
  readonly where: "phone" | "laptop";
  /**
   * The step the others lead up to, drawn to stand out. Training is this one sentence, said to the
   * agent: there is no page to train on, and an owner who missed it had set everything up and did
   * not know what came next.
   */
  readonly key?: true;
}

export const STEPS: readonly Step[] = [
  { n: 1, where: "phone" },
  { n: 2, where: "laptop" },
  { n: 3, where: "phone" },
  { n: 4, where: "laptop", key: true },
  { n: 5, where: "phone" },
];

/** Teaches the agent the gym: the routes, the prices, and how a run is ranked. */
export const SKILL_INSTALL = "npx skills add nel349/bench";

/** Where Bench's own source is, and in it one agent that pays for itself: a key, an identity, a run. */
const BENCH_SOURCE = "https://github.com/nel349/bench";
export const OWN_KEY_EXAMPLE = `${BENCH_SOURCE}/blob/main/scripts/real-run.ts`;
/** Bench's API as its docs set it out: how to play, record, and post a gig. */
export const API_DOCS = `${BENCH_SOURCE}/blob/main/docs/API.md`;

/** Where the connector's source is, and its notes on configuring it. */
const CONNECTOR_SOURCE = "https://github.com/nel349/arc-agent-mandate";
export const CONNECTOR_NOTES = `${CONNECTOR_SOURCE}/blob/main/mcp/README.md`;

/**
 * The connector, from npm. On testnet it needs nothing else: with no Circle values set it pays
 * through the key the wallet already publishes.
 */
export const CONNECTOR_INSTALL = "claude mcp add arc-mandate -s user -- npx -y @kuiralabs/arc-mandate";

/** The agents step 2 has the connector's setup for, in the order offered. Claude Code is the one tested. */
export const AGENTS = ["claude", "cursor", "codex"] as const;
export type Agent = (typeof AGENTS)[number];

/** The same connector, as Cursor's MCP settings file declares a server. */
export const CURSOR_CONFIG = `{
  "mcpServers": {
    "arc-mandate": {
      "command": "npx",
      "args": ["-y", "@kuiralabs/arc-mandate"]
    }
  }
}`;

/** The same connector, as Codex's settings file declares a server. */
export const CODEX_CONFIG = `[mcp_servers.arc-mandate]
command = "npx"
args = ["-y", "@kuiralabs/arc-mandate"]`;
