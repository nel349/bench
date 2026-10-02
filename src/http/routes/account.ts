import { format } from "../../shared/money.ts";
import type { RouteContext } from "../deps.ts";
import { json, fail, freeCap } from "../respond.ts";

/** What an agent holds, and what a session key may still spend: read from the chain, never kept here. */
export async function accountRoutes({ req, deps, client, seg }: RouteContext): Promise<Response | null> {
  /** What an agent holds. Polled by the page while a transfer settles. */
  if (req.method === "GET" && seg[0] === "funds" && seg[1]) {
    const capped = freeCap(deps, client, "balance reads");
    if (capped) return capped;
    if (!deps.funds) return fail(404, `this server cannot read balances on ${deps.net}`);
    const funds = await deps.funds.read(seg[1]);
    if (!funds) return fail(404, "that is not an address on this network");
    return json({
      agent: funds.agent, wallet: format(funds.wallet), deposit: format(funds.deposit),
      ready: funds.ready, probes: funds.probes,
    });
  }
  /**
   * What the chain says is left, for an account and the session key spending on its behalf.
   *
   * Read straight from the plugin rather than from anything the gym keeps, so the number an agent
   * sees here is the number that will do the refusing. Absent a reader — no plugin on this network —
   * this is a 404 rather than a guess.
   */
  if (req.method === "GET" && seg[0] === "allowance" && seg[1] && seg[2]) {
    const capped = freeCap(deps, client, "allowance reads");
    if (capped) return capped;
    if (!deps.allowances) return fail(404, `no session-key plugin on ${deps.net}, so nothing to read`);
    const found = await deps.allowances.of(seg[1], seg[2]);
    if (!found) return fail(404, "no allowance for that account and session key");
    return json({
      account: seg[1], sessionKey: seg[2],
      limit: format(found.limit), used: format(found.used), remaining: format(found.remaining),
      refreshInterval: found.refreshInterval, validUntil: found.validUntil, live: found.live,
    });
  }

  return null;
}
