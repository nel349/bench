import { getAddress, toHex, type Address, type Hex } from "viem";
import { randomBytes } from "node:crypto";
import { b64, X402_VERSION, type PaymentPayload, type ResourceDescriptor } from "./facilitator.ts";
import { chainOf, type Network } from "./chain.ts";

/**
 * The buying half, so there is one definition of a well-formed payment.
 *
 * A seller that has never been paid by anything real is a seller whose idea of a valid payment is
 * whatever its own tests construct. Ours was wrong in four ways at once — the wrong version, a
 * missing `resource`, a missing `accepted`, and a price field under a name no buyer reads — and
 * every test passed, because the tests built payments in the same wrong shape the server expected.
 *
 * This is the shape Circle actually accepts and the shape the agents on Arc actually send. It is
 * used by the tests, by the facilitator probe, and by anything that wants to buy from us.
 */

/** One entry of a seller's `accepts` list, as a buyer reads it. */
export interface AcceptedTerms {
  readonly scheme: string;
  readonly network: string;
  readonly asset: string;
  readonly amount: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds?: number;
  readonly extra: { readonly name: string; readonly version: string; readonly verifyingContract: string };
}

export interface Authorization {
  readonly from: Address;
  readonly to: Address;
  readonly value: string;
  readonly validAfter: string;
  readonly validBefore: string;
  readonly nonce: Hex;
}

/** Signs `Authorization` as EIP-712. A viem account satisfies this; so does anything else that can. */
export interface Signer {
  readonly address: Address;
  signTypedData(args: {
    domain: { name: string; version: string; chainId: number; verifyingContract: Address };
    types: Record<string, readonly { name: string; type: string }[]>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex>;
}

export const AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** Gateway will not batch an authorisation that might expire before the batch settles. */
export const MIN_VALIDITY_SECONDS = 7 * 24 * 60 * 60 + 100;
/** Backdated a little, so a seller whose clock runs slow does not reject a fresh authorisation. */
export const BACKDATE_SECONDS = 600;

export function authorizationFor(
  from: Address, terms: AcceptedTerms, now = Math.floor(Date.now() / 1000),
): Authorization {
  const validity = Math.max(Number(terms.maxTimeoutSeconds ?? 0), MIN_VALIDITY_SECONDS);
  return {
    from: getAddress(from),
    to: getAddress(terms.payTo),
    value: String(terms.amount),
    validAfter: String(now - BACKDATE_SECONDS),
    validBefore: String(now + validity),
    // Not a counter: Gateway treats this as an idempotency key, so it must never repeat.
    nonce: toHex(randomBytes(32)),
  };
}

export async function signAuthorization(
  signer: Signer, net: Network, terms: AcceptedTerms, authorization: Authorization,
): Promise<Hex> {
  return signer.signTypedData({
    domain: {
      name: terms.extra.name,
      version: terms.extra.version,
      chainId: chainOf(net).id,
      verifyingContract: getAddress(terms.extra.verifyingContract),
    },
    types: AUTHORIZATION_TYPES as unknown as Record<string, readonly { name: string; type: string }[]>,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });
}

export function payloadFor(
  terms: AcceptedTerms, resource: ResourceDescriptor, authorization: Authorization, signature: Hex,
): PaymentPayload {
  return {
    x402Version: X402_VERSION,
    scheme: terms.scheme,
    network: terms.network,
    resource,
    accepted: terms as unknown as Record<string, unknown>,
    payload: { authorization, signature },
  };
}

/** Everything above, in the order a buyer does it. The value goes in the payment header. */
export async function paymentHeader(
  signer: Signer, net: Network, terms: AcceptedTerms, resource: ResourceDescriptor, now?: number,
): Promise<string> {
  const authorization = authorizationFor(signer.address, terms, now);
  const signature = await signAuthorization(signer, net, terms, authorization);
  return b64.encode(payloadFor(terms, resource, authorization, signature));
}

/** The entry a buyer on this network can satisfy, out of everything a seller offers. */
export function payableOn(net: Network, body: unknown): AcceptedTerms | null {
  const accepts = (body as { accepts?: unknown })?.accepts;
  if (!Array.isArray(accepts)) return null;
  const want = `eip155:${chainOf(net).id}`;
  return accepts.find((o): o is AcceptedTerms =>
    typeof o === "object" && o !== null &&
    (o as AcceptedTerms).network === want &&
    typeof (o as AcceptedTerms).amount === "string" &&
    typeof (o as AcceptedTerms).payTo === "string" &&
    typeof (o as AcceptedTerms).extra?.verifyingContract === "string") ?? null;
}
