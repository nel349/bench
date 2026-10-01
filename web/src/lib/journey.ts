/**
 * The path an owner takes to let their agent train here, in five steps.
 *
 * The titles are the ones the arc-mandate connector tells an agent and the maze prints, in the same
 * order, so a person who meets the steps in the wallet, from their agent and on this page reads one
 * path. Those are separate programs and cannot import this; if a title changes there, it changes here.
 *
 * The order is real rather than presentation: the wallet and the connected agent both come before
 * the grant, because a grant needs money behind it and an agent to grant to, and the grant comes
 * before the agent is told to start.
 */
export interface Step {
  readonly title: string;
  /** Which device the person is holding for this step. */
  readonly where: "phone" | "laptop";
  /** One sentence: what to do, and why it comes here. */
  readonly detail: string;
}

export const STEPS: readonly Step[] = [
  {
    title: "Get the app, and add test USDC",
    where: "phone",
    detail: "It opens in your phone's browser and makes a wallet with a passkey. Your agent can never spend more than it holds.",
  },
  {
    title: "Connect your agent",
    where: "laptop",
    detail: "Add the Bench skill and the connector. The connector gives the agent its own key and shows it as a code.",
  },
  {
    title: "Scan to grant",
    where: "phone",
    detail: "In the wallet: New allowance, scan the code, set a limit and how long, and confirm with your passkey.",
  },
  {
    title: "Tell your agent to play",
    where: "laptop",
    detail: "Give it one sentence, word for word. It trains from there.",
  },
  {
    title: "Watch it spend, revoke any time",
    where: "phone",
    detail: "Each payment shows in the wallet as it lands. Revoke mid-run and the next one is refused.",
  },
];

/** Teaches the agent the gym: the routes, the prices, and how a run is ranked. */
export const SKILL_INSTALL = "npx skills add nel349/bench";

/** Where the connector's source is, and its notes on configuring it. */
const CONNECTOR_SOURCE = "https://github.com/nel349/arc-agent-mandate";
export const CONNECTOR_NOTES = `${CONNECTOR_SOURCE}/blob/main/mcp/README.md`;

/**
 * The connector, from npm. On testnet it needs nothing else: with no Circle values set it pays
 * through the key the wallet already publishes.
 */
export const CONNECTOR_INSTALL = "claude mcp add arc-mandate -s user -- npx -y @kuiralabs/arc-mandate";

/**
 * The one sentence step 4 has a person give their agent.
 *
 * A link alone does not do it: an agent handed a URL reads the page and stops, because nothing told
 * it to do anything.
 */
export const promptFor = (gym: string): string =>
  `Train on Bench at ${gym}: rank as many problems as you can, and spend as little as you can.`;
