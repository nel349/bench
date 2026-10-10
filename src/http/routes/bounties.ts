import { ANONYMOUS } from "../../gym/attempt.ts";
import { PRICE } from "../../shared/pricing.ts";
import { format } from "../../shared/money.ts";
import { Serial } from "../../gym/serialize.ts";
import { wireBounty } from "../../bounties/bounties.ts";
import type { Backing } from "../../chain/escrow.ts";
import { PATHS } from "../../shared/paths.ts";
import type { Deps, RouteContext } from "../deps.ts";
import { json, fail, unavailable, agentOf, claimedIdOf, ANSWER_PARAM, fromUrl, NO_BODY, bodyOf, isRecord, freeCap, limited } from "../respond.ts";
import { paymentRefused, paymentRequired, proofOf } from "../payment.ts";
import { ratingOf, identitiesByPayer } from "../reads.ts";

/** What an unqualified agent is told to do, in one place. */
const HOW_TO_QUALIFY =
  "rank solved runs on different problems: easy counts 1, medium 2, hard 3. " +
  "Send X-Agent-Id with your ERC-8004 id, from the address that id names as its wallet";
/**
 * Moves the money for a bounty that has been won.
 *
 * Returns `null` when there is nothing to try — no arbiter configured, or no escrow behind this
 * bounty — which is a different thing from a payout that was attempted and failed, and reads
 * differently in the response.
 */
async function payOut(
  deps: Deps, id: string,
): Promise<{ ok: true; tx: string } | { ok: false; because: string } | null> {
  /**
   * One payout attempt at a time, per bounty.
   *
   * The retry route is open to anyone on purpose — it can only pay the address already recorded as
   * the winner — but every call used to send a transaction, and the contract reverts a duplicate
   * rather than refusing cheaply. So a stranger could spend our gas at will by repeating a request
   * designed to be safe to repeat. Concurrent calls now collapse into one attempt, and the second
   * finds the work already done.
   */
  return payouts.run(`bounty:${id}`, async () => {
    const bounty = deps.bounties?.get(id);
    if (!deps.arbiter || !bounty?.escrowId || !bounty.solvedBy || bounty.awardTx) return null;

    /**
     * Ask the chain before spending gas on it.
     *
     * An escrow already settled cannot be awarded again, and finding that out by sending a
     * transaction that reverts costs us and nobody else. A read costs nothing.
     */
    if (deps.escrow) {
      const state = await deps.escrow.read(bounty.escrowId);
      if (state.ok && state.backing.settled) {
        return { ok: false, because: "that escrow has already been settled on chain" };
      }
    }

    const out = await deps.arbiter.award(bounty.escrowId, bounty.solvedBy);
    if (out.ok) deps.bounties!.paid(id, out.tx);
    return out;
  });
}
/** Keyed by bounty, so two payouts for different bounties never wait for each other. */
const payouts = new Serial();

/** Gigs: posting one, reading them, and entering one, which pays out from escrow when it is won. */
export async function bountyRoutes({ req, deps, client, url, path, seg }: RouteContext): Promise<Response | null> {
  /**
   * Bounties. Posting is free; attempting one costs a graded submission, as it does anywhere else.
   *
   * The answer key never appears in any of these responses. `wireBounty` is the only way a bounty
   * reaches a body, and it has no field for one.
   */
  if (seg[0] === "bounties" && !deps.bounties) return fail(404, "bounties are not enabled on this server");
  if (req.method === "GET" && path === PATHS.bounties) {
    // Asked every few seconds by every open page: the record is read through once, not once a gig.
    const named = identitiesByPayer(deps.attempts.all());
    return json(deps.bounties!.all().map((b) => (
      { ...wireBounty(b), solverIdentity: b.solvedBy === null ? null : named.get(b.solvedBy.toLowerCase()) ?? null }
    )));
  }
  if (req.method === "POST" && path === PATHS.bounties) {
    const capped = freeCap(deps, client, "bounties posted");
    if (capped) return capped;
    const agent = agentOf(req) ?? ANONYMOUS;
    const body = await bodyOf(req);
    if (!isRecord(body)) return fail(400, "posting a bounty takes a JSON object");

    /**
     * The escrow is checked before the bounty exists, not after.
     *
     * A bounty that cannot be paid should never be posted, rather than be discovered unpayable by
     * whoever wins it. And the money, the deadline and the poster are then taken from the contract
     * rather than from this request — so a listing cannot claim more than is held, outlive the
     * escrow behind it, or attribute somebody else's money to the sender.
     */
    let backing: Backing | undefined;
    if (typeof body["escrowId"] === "string" && body["escrowId"].trim().length > 0) {
      if (!deps.escrow) {
        return fail(503, "this server cannot check an escrow, so it will not take a backed bounty");
      }
      const read = await deps.escrow.read(body["escrowId"]);
      if (!read.ok) {
        // Being unable to ask is our failure and costs a retry; a bad id is the poster's and does not.
        return "unavailable" in read ? unavailable(read.because) : fail(400, read.because);
      }
      backing = read.backing;
    }

    // A bar nobody here can check is a bar that means nothing, so it is not accepted.
    if (typeof body["minRating"] === "number" && body["minRating"] > 0 && !deps.reputation) {
      return fail(409, "this server has no reputation registry to check a record against, " +
        "so it cannot take a bounty that requires one. Post it with minRating 0");
    }

    const posted = deps.bounties!.post({ poster: agent, ...body } as never, Date.now(), backing);
    if (!posted.ok) {
      return json({ error: posted.problem, ...(posted.at ? { at: posted.at } : {}) }, 400);
    }
    return json(wireBounty(posted.bounty), 201);
  }
  if (seg[0] === "bounties" && seg[1]) {
    const bounty = deps.bounties!.get(seg[1]);
    if (!bounty) return fail(404, `no bounty ${seg[1]}`);

    if (req.method === "GET" && seg.length === 2) return json(wireBounty(bounty));

    /**
     * Retry a payout that never landed. Free, and safe to call repeatedly.
     *
     * Open to anyone, because there is nothing here to abuse: it can only send money to the address
     * already recorded as the winner, and it does nothing at all once a transaction has settled.
     * Requiring a key would mean a winner waiting on us to notice.
     */
    if (req.method === "POST" && seg[2] === "award") {
      if (!bounty.solvedBy) return fail(409, "nobody has won this bounty yet");
      if (bounty.awardTx) return json({ alreadyPaid: true, tx: bounty.awardTx });
      if (!bounty.escrowId) return fail(409, "this bounty has no escrow behind it to pay from");

      const payout = await payOut(deps, bounty.id);
      if (!payout?.ok) {
        return json({ paid: false, because: payout?.because ?? "no arbiter is configured" }, 503);
      }
      return json({ paid: true, tx: payout.tx, bounty: wireBounty(deps.bounties!.get(bounty.id)!) });
    }

    if (req.method === "POST" && seg[2] === "solve") {
      const agent = agentOf(req) ?? ANONYMOUS;
      const read = await bodyOf(req);
      const inUrl = fromUrl(url, ANSWER_PARAM);
      const body = read === NO_BODY && inUrl !== NO_BODY ? { answer: inUrl } : read;
      if (!isRecord(body) || !("answer" in body)) {
        return fail(400, `solving takes a JSON object with an answer, {"answer": ...}, or ?${ANSWER_PARAM}=`);
      }

      /**
       * Refused before charged, where we already know enough to refuse.
       *
       * The authoritative gate is inside `solve`, against the address that paid, because a header
       * is not an identity. But charging first meant an unqualified agent paid a graded-submission
       * fee to be told it could not play — the same tax on a rejected request that a malformed
       * probe is deliberately spared. A rating is public, so answering this early leaks nothing.
       */
      const claimed = claimedIdOf(req);
      // Attempting a bounty is a graded submission too, capped per client since the payer is not
      // known until the payment arrives.
      const bountyKey = `client:${client}`;
      const room = deps.limits?.graded.check(bountyKey);
      if (room && !room.ok) return limited(room.retryAfterMs, "graded submissions");
      let standing: number;
      try {
        standing = await ratingOf(deps, claimed);
      } catch {
        return unavailable("the reputation registry could not be read, so a record cannot be checked");
      }
      const eligible = deps.bounties!.eligibility(bounty.id, agent, standing);
      if (!eligible.ok) {
        if ("closed" in eligible) return json({ error: eligible.closed }, 409);
        return json({
          error: "this bounty is for agents with a record", rating: eligible.rating, needs: eligible.needs,
          how: HOW_TO_QUALIFY,
          charged: false,
        }, 403);
      }

      /**
       * Attempting a bounty is charged like a graded submission, and the payment is what names the
       * solver. A bounty pays an address; a header is not one.
       */
      const charge = await deps.payments.charge(agent, PRICE.submit, `bounty ${bounty.id}`, proofOf(req));
      if (!charge.ok) {
        if ("needsPayment" in charge) return paymentRequired(charge.needsPayment, path, deps.net);
        if ("unavailable" in charge) return unavailable(charge.unavailable);
        if (charge.refused === "payment") return paymentRefused(charge.reason, charge.quote, path, deps.net);
        return json({ refused: charge.refused, wanted: format(charge.wanted), remaining: format(charge.remaining) });
      }

      /**
       * The record counts only if the identity it was read for is paid for by the address that just
       * paid. Otherwise anyone could claim a qualified agent's id and borrow its rating.
       */
      const solver = charge.payer ?? agent;
      const owned = claimed !== null && deps.verifyIdentity !== undefined &&
        await deps.verifyIdentity(claimed, solver).catch(() => false);
      const out = deps.bounties!.solve(bounty.id, body.answer, solver, owned ? standing : 0);
      deps.limits?.graded.take(bountyKey);

      if (out.ok) {
        /**
         * Won first, paid second.
         *
         * The win is already recorded by the time this runs, and a failed payout must not undo it —
         * otherwise a prize would depend on the gas market at the moment somebody answered. A
         * bounty left with a winner and no transaction is reported as `awaitingPayout` and swept by
         * `POST /bounties/:id/award`.
         */
        const payout = await payOut(deps, bounty.id);
        return json({
          solved: true, solver: out.solver,
          ...(payout ? { payout } : {}),
          bounty: wireBounty(deps.bounties!.get(bounty.id)!),
        });
      }
      if ("unqualified" in out) {
        /**
         * Only reachable when the payer is a different identity from the header — the free check
         * above passed on the name and the authoritative one failed on the address. Rare, and the
         * agent's own doing, but it has been charged, so the body says so rather than pretending.
         */
        return json({
          error: "this bounty is for agents with a record", rating: out.rating, needs: out.needs,
          how: HOW_TO_QUALIFY,
          charged: true,
          note: "the record was read for the ERC-8004 id you sent, and that id is not paid for by the address that paid",
        }, 403);
      }
      if ("closed" in out) return json({ error: out.closed }, 409);
      return json({ solved: false, because: out.because, at: out.at });
    }
  }

  return null;
}
