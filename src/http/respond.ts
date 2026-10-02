import type { AgentId } from "../gym/payments.ts";
import { parseAgentId } from "../chain/identity.ts";
import type { Deps } from "./deps.ts";

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
export const fail = (status: number, error: string): Response => json({ error }, status);
/**
 * Our end broke. Deliberately **not** a 402, because the caller's money is fine and telling them
 * otherwise sends them to debug a wallet that has nothing wrong with it.
 */
export const unavailable = (reason: string): Response =>
  json({ error: reason, retry: true }, 503, { "Retry-After": "5" });
/**
 * Who is asking, if they said.
 *
 * **Optional, and it used to be mandatory.** Requiring it contradicted the rule this API is built
 * on: identity comes from payment, the payer is proven, and the header is a label. Yet it was
 * demanded on a *free* call, so an agent had to name itself before paying for anything and the name
 * it invented was then not the identity it ended up with.
 *
 * It also made the product unusable. The only real client that exists — the mandate's connector —
 * does not send it, so every agent using it was refused at the first request, before payment was
 * involved. The seller and the buyer had never been pointed at each other.
 *
 * A run is anonymous until its first payment binds it to an address. Absent a header, a run is
 * labelled by the payer once there is one, and until then by nothing.
 */
export function agentOf(req: Request): AgentId | null {
  const id = req.headers.get("x-agent");
  return id && id.trim().length > 0 ? id.trim() : null;
}
/**
 * The ERC-8004 id an agent says is its own.
 *
 * A claim, and treated as one: it is recorded on the run and only becomes an identity if the
 * registry says the address that paid is the wallet behind it. Malformed is silently no claim rather
 * than a 400 — an agent that sends a junk id still gets to run, it simply runs unidentified.
 */
export const claimedIdOf = (req: Request): bigint | null =>
  parseAgentId(req.headers.get("x-agent-id") ?? new URL(req.url).searchParams.get(AGENT_PARAM));
/**
 * What a request can carry in its URL instead of its body or headers.
 *
 * The arc-mandate connector's `buy` tool, the one real client, sends a method and a URL and nothing
 * else. Every step of a run therefore works from the URL alone too: `?problem=` and `?budget=` to start,
 * `?q=` for a probe, `?answer=` to submit, and `?agent=` for an ERC-8004 id, which is the parameter the
 * connector's own instructions tell an agent to use. A body or header, where sent, still wins.
 */
export const AGENT_PARAM = "agent";
export const QUESTION_PARAM = "q";
export const ANSWER_PARAM = "answer";
/** A value from the URL, as JSON where it is JSON (`748`, `["A","B"]`) and as text where not (`EESS`). */
export function fromUrl(url: URL, name: string): unknown {
  const raw = url.searchParams.get(name);
  if (raw === null) return NO_BODY;
  try { return JSON.parse(raw) as unknown; } catch { return raw; }
}
/** What `bodyOf` returns when there is no body, or it is not JSON. Distinct from any value JSON can hold. */
export const NO_BODY: unique symbol = Symbol("no body");
/**
 * The request's JSON, whatever it is: an object, an array, a string, a number, even `false`.
 *
 * Every route used to read the body with `.catch(() => null)` and then test `"answer" in body`. A
 * bare string is valid JSON, and `in` on a string throws, so Codebreaker's documented probe, `"ABCD"`,
 * was a 500 every time, and a bare `0` was taken for no body at all. The functional test on testnet
 * found it; the unit tests had called the lifecycle directly and never sent a string.
 */
export async function bodyOf(req: Request): Promise<unknown> {
  try { return await req.json(); } catch { return NO_BODY; }
}
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
/**
 * The per-client cap on a free request, or nothing if it may go ahead. For the free routes that
 * read the chain or ask Circle, which a script could otherwise turn into our cost for nothing.
 */
export function freeCap(deps: Deps, client: string, what: string): Response | null {
  const free = deps.limits?.free.take(`client:${client}`);
  return free && !free.ok ? limited(free.retryAfterMs, what) : null;
}
/** Past a limit: a 429 that says how long to wait, before anything is charged. */
export function limited(retryAfterMs: number, what: string): Response {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return json({ error: `too many ${what}; try again in ${seconds}s`, retryAfter: seconds, charged: false },
              429, { "Retry-After": String(seconds) });
}
