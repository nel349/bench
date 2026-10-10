import type { Quote } from "../gym/payments.ts";
import { caip2, contractsOf, type Network } from "../chain/chain.ts";
import { b64, MIN_VALIDITY_SECONDS, PAYMENT_HEADERS, REQUIRED_HEADER, SETTLEMENT_HEADER, X402_VERSION } from "../chain/facilitator.ts";
import { json } from "./respond.ts";

/**
 * The payment came, and did not work. Still a 402: the request is unpaid and paying it correctly is
 * what fixes it, so the quote goes back out with the reason. The run is untouched — see `BadPayment`.
 */
export const paymentRefused = (reason: string, quote: Quote, path: string, net: Network): Response =>
  quoted(`that payment was not accepted: ${reason}`, quote, path, net);
/**
 * One entry of an x402 `accepts` list: what to pay, where, and on which chain.
 *
 * `amount`, not `maxAmountRequired`. The buyers on Arc read `amount`, and the earlier spelling —
 * taken from the specification rather than from anything that pays — made every quote here
 * unpayable by a real agent while looking perfectly correct.
 *
 * `extra` carries the EIP-712 domain the authorisation is signed against, and without it there is
 * nothing for a buyer to sign.
 */
export const accepts = (q: Quote, resource: string, net: Network) => ({
  scheme: q.scheme,
  network: q.chain,
  resource,
  amount: q.amount.toString(),
  asset: q.token,
  payTo: q.payTo,
  maxTimeoutSeconds: q.maxTimeoutSeconds ?? MIN_VALIDITY_SECONDS,
  /**
   * The signing domain, filled in from the network when the payments implementation did not supply
   * one — which is the in-memory allowance used in development.
   *
   * Without it a dev 402 is unparseable by a real agent: there is no domain to sign against, so the
   * quote cannot be acted on at all. Dev mode not verifying a signature is the point of dev mode;
   * dev mode emitting a quote nobody could sign makes rehearsing the real flow impossible, and
   * would have hidden every one of the protocol bugs found here.
   */
  extra: q.extra ?? {
    name: "GatewayWalletBatched",
    version: "1",
    verifyingContract: contractsOf(net).gatewayWallet,
  },
});
/**
 * The x402 body.
 *
 * `resource` appears at the top level as well as inside each entry, because that is where a buyer
 * reads it from when building its payment, and a payment without it is rejected by Circle before
 * it is looked at.
 */
export function paymentRequired(q: Quote, resource: string, net: Network): Response {
  return quoted("payment required", q, resource, net);
}
/**
 * Every 402 this server sends, built one way: the version-2 object in the body, and the same object
 * in `PAYMENT-REQUIRED`, where a version-2 buyer looks for it. The refusal of a bad payment used to be
 * built separately, and still said version 1 and carried no resource.
 */
export function quoted(error: string, q: Quote, resource: string, net: Network): Response {
  const body = { x402Version: X402_VERSION, error, resource: describes(resource), accepts: [accepts(q, resource, net)] };
  return json(body, 402, { [REQUIRED_HEADER]: b64.encode(body) });
}
/**
 * What is being bought, in the shape the facilitator requires.
 *
 * A bare URL is refused, and all three fields are mandatory. The URL is left relative because the
 * hostname is not ours to assume behind a proxy; a buyer resolves it against the host it asked.
 */
export const describes = (path: string) => ({
  url: path,
  description: BOUGHT[path.slice(path.lastIndexOf("/") + 1)] ?? BOUGHT.ask!,
  mimeType: "application/json",
});

/**
 * What each paid route sells, by its last segment, in the words the owner's page uses: a buyer's
 * wallet may show it beside the payment, and recording a solve used to read "One probe".
 */
const BOUGHT: Readonly<Record<string, string>> = {
  ask: "One question",
  submit: "A graded answer",
  rank: "Recording a solve to the agent's ERC-8004 identity",
  solve: "An answer to a gig",
};
/**
 * The payment, from whichever header it arrived in. See `PAYMENT_HEADERS`.
 */
export const proofOf = (req: Request): string | null => {
  for (const name of PAYMENT_HEADERS) {
    const value = req.headers.get(name);
    if (value && value.trim().length > 0) return value.trim();
  }
  return null;
};
/**
 * The settlement receipt, on every answer to a request whose payment was taken.
 *
 * A buyer decides whether it paid from this rather than from the status code, so a 200 that took
 * money and said so only in its body leaves the buyer's ledger wrong — and it is the buyer's owner
 * who then cannot reconcile it.
 */
export const receipted = (res: Response, charge: { payer?: string; settlement?: string }, net: Network): Response => {
  res.headers.set(SETTLEMENT_HEADER, b64.encode({
    success: true,
    transaction: charge.settlement ?? null,
    network: caip2(net),
    payer: charge.payer ?? null,
  }));
  return res;
};
/** The addresses a quote points at, for whichever network this process serves. */
export function quoteFor(net: Network, amount: bigint, payTo: string): Quote {
  return { amount, chain: caip2(net), token: contractsOf(net).usdc, payTo, scheme: "exact" };
}
