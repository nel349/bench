import { PRICE } from "../shared/pricing.ts";
import { format } from "../shared/money.ts";
import { network } from "../chain/chain.ts";
import "../problems/blackbox.ts";
import "../problems/zendo.ts";
import "../problems/toll.ts";
import "../problems/bisect.ts";
import "../problems/codebreaker.ts";
import "../problems/ranking.ts";
import "../problems/liar.ts";
import type { Deps, RouteContext } from "./deps.ts";
import { json, fail, limited } from "./respond.ts";
import { proofOf } from "./payment.ts";
import { isPagePath, wantsHtml, servedFile } from "./page.ts";
import { gymRoutes } from "./routes/gym.ts";
import { accountRoutes } from "./routes/account.ts";
import { recordRoutes } from "./routes/records.ts";
import { bountyRoutes } from "./routes/bounties.ts";

export type { Deps } from "./deps.ts";
export { quoteFor } from "./payment.ts";

/**
 * The HTTP surface, as one function from a request to a response.
 *
 * No socket, no port, no framework. `handle` is called directly by the tests, which is what keeps
 * the default test lane runnable with nothing configured — and it means the routing and the rules
 * are exercised together rather than the rules being tested and the routing hoped about.
 *
 * Three answers matter and they are deliberately different HTTP shapes:
 *
 *   - **402** — you have not paid. Sign the quote and ask again. Nothing happened.
 *   - **200 with `refused`** — you paid your way to the limit and it stopped you. The run is over
 *     and this is a *result*, not an error, so it is not a 4xx. This is the product working.
 *   - **200** — it worked.
 */


/**
 * Nothing escapes as a bare 500.
 *
 * A route that throws used to become an empty 500 with no body, which is the least useful thing an
 * API can do — it tells a caller that something went wrong and nothing about what or whose fault it
 * was. Found by firing a malformed probe at an attempt that had already been solved: the answer was
 * a 500 where it should have been "that run is over".
 */
export async function handle(req: Request, deps: Deps, client = "unknown"): Promise<Response> {
  try {
    /**
     * A payment that fails verification costs us a call to Circle and costs its sender nothing, so
     * failed ones are capped per client. Checked before the route runs, so a client past the cap
     * causes no call at all, and counted only when a payment was actually refused.
     */
    const paying = proofOf(req) !== null && deps.limits !== undefined;
    const refusedKey = `client:${client}`;
    if (paying) {
      const room = deps.limits!.refused.check(refusedKey);
      if (!room.ok) return limited(room.retryAfterMs, "refused payments");
    }
    const res = await route(req, deps, client);
    if (paying && res.status === 402) deps.limits!.refused.take(refusedKey);
    return res;
  } catch (cause) {
    /**
     * Logged, never returned.
     *
     * `detail` used to carry the thrown message straight back to the caller, which undoes the care
     * taken everywhere else: a viem error names the RPC endpoint — and an endpoint can carry a key
     * — while a SQLite error names a path on our disk. None of it helps whoever asked, and the
     * parts that would help them are already the 4xx answers above.
     */
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[bench] ${req.method} ${new URL(req.url).pathname}: ${message}`);
    return json({ error: "something went wrong here, and it is not your request" }, 500);
  }
}

/** The groups of routes, tried in turn; each answers what is its own and passes on the rest. */
const ROUTES = [gymRoutes, accountRoutes, recordRoutes, bountyRoutes] as const;

async function route(req: Request, deps: Deps, client: string): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const seg = path.split("/").filter(Boolean);
  const prices = { ask: format(PRICE.ask), submit: format(PRICE.submit), rank: format(PRICE.rank) };
  const ctx: RouteContext = { req, deps, client, url, path, seg, prices };
  for (const routes of ROUTES) {
    const answered = await routes(ctx);
    if (answered) return answered;
  }

  /**
   * The browser app, where it has been built.
   *
   * Anything not an API route falls through to the single page, so a deep link works on a reload
   * rather than 404ing — the app decides what to render from the URL. Absent a build, this says so
   * instead of serving nothing.
   */
  if (req.method === "GET") {
    const served = await servedFile(path, wantsHtml(req) || isPagePath(path));
    if (served) return served;
  }

  return fail(404, `no route for ${req.method} ${path}`);
}

export const currentNetwork = network;
