/**
 * Every duration in the app, named.
 *
 * The script this replaces had `3000`, `40`, `1200` and `4001` inline, and only one of them was a
 * duration — `4001` is a wallet's code for "the person said no", which reading the numbers in
 * place gave no way to know.
 */

/** How often to ask whether a deposit has landed. Gateway settles in seconds, not minutes. */
export const POLL_WHILE_SETTLING_MS = 3_000;

/** How long a "sent" message stays before the page reflects the new balance on its own. */
export const CONFIRMATION_LINGER_MS = 1_200;
