/**
 * The facilitator, as the two methods we actually call.
 *
 * Circle's `BatchFacilitatorClient` from `@circle-fin/x402-batching` is the real one, and it is
 * deliberately **not** imported here. Adding a dependency is a decision, not a detail, so the
 * interface is structural: `ArcPayments` is written and tested against this shape today, and the
 * real client drops in at the composition root the moment somebody says so.
 *
 * It also means the tests never reach the network, which is the rule the whole suite runs under.
 */
/**
 * What a buyer actually sends, which is more than the signature.
 *
 * The first version of this was `{ x402Version, payload }`, taken from the shape Circle's compiled
 * client passes through. That was reading the wrong thing: the client forwards whatever it is
 * handed, so its types say nothing about what the *caller* has to build. Circle rejects the short
 * form outright — `paymentPayload.resource: Required, paymentPayload.accepted: Required` — and no
 * test caught it, because every test stubbed the facilitator with the shape we invented.
 *
 * `accepted` is the entry from our own `accepts` list that the buyer chose, echoed back so the
 * facilitator can check the payment against the terms rather than against our word for them.
 */
/**
 * What is being bought, as Circle's facilitator insists on describing it.
 *
 * A URL string is rejected: `paymentPayload.resource: Expected object, received string`. All three
 * fields are required, and the validator will tell you so one field at a time, which is how this
 * shape was found — by asking it rather than by reading a specification that does not mention it.
 */
export interface ResourceDescriptor {
  readonly url: string;
  readonly description: string;
  readonly mimeType: string;
}

export interface PaymentPayload {
  readonly x402Version: number;
  readonly scheme: string;
  readonly network: string;
  /** What is being bought. An object, not a URL — see `ResourceDescriptor`. */
  readonly resource: ResourceDescriptor;
  readonly accepted: Record<string, unknown>;
  readonly payload: Record<string, unknown>;
}

export interface PaymentRequirements {
  readonly scheme: "exact";
  readonly network: string;
  readonly asset: string;
  readonly amount: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds: number;
  readonly extra?: Record<string, unknown>;
}

export interface VerifyResult { readonly isValid: boolean; readonly invalidReason?: string; readonly payer?: string }
export interface SettleResult { readonly success: boolean; readonly errorReason?: string; readonly payer?: string; readonly transaction?: string }

export interface Facilitator {
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResult>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResult>;
}

/**
 * Gateway will not batch an authorisation that might expire before the batch settles, so it wants a
 * week. A seller advertising less is asking for a payment the facilitator will refuse.
 */
export const MIN_VALIDITY_SECONDS = 7 * 24 * 60 * 60;

export const b64 = {
  encode: (v: unknown): string => Buffer.from(JSON.stringify(v)).toString("base64"),
  decode: (v: string): unknown => JSON.parse(Buffer.from(v, "base64").toString("utf8")),
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Does this header carry the shape the facilitator expects?
 *
 * A guard rather than a cast, because the header is written by whoever is calling us. Asserting a
 * stranger's JSON is well formed is the one thing we do not know, and the failure would surface
 * inside somebody else's client as a confusing error about their code.
 */
export const isPaymentPayload = (v: unknown): v is PaymentPayload =>
  isRecord(v) &&
  typeof v["x402Version"] === "number" &&
  typeof v["scheme"] === "string" &&
  typeof v["network"] === "string" &&
  isRecord(v["resource"]) &&
  typeof (v["resource"] as Record<string, unknown>)["url"] === "string" &&
  isRecord(v["accepted"]) &&
  isRecord(v["payload"]);

/**
 * Verifying is **not** proof of funds.
 *
 * `/verify` returned `isValid: true` for a freshly generated account holding nothing and with no
 * Gateway deposit — it checks the signature and the terms, not the balance. A seller that served
 * its answer on a successful verify would hand out everything it sells to anyone who can sign, for
 * nothing.
 *
 * Only `/settle` moves money and only its success means anything was paid. `ArcPayments` does both,
 * in that order, and this is the reason it must.
 */
export const VERIFY_IS_NOT_PAYMENT = true;

/**
 * The version of x402 spoken here.
 *
 * Two, not one. The buyers on Arc send `x402Version: 2` and Circle's facilitator expects it; a 402
 * advertising 1 is answered by a payment carrying 2, and the mismatch is silent until settlement.
 */
export const X402_VERSION = 2;

/** Where an x402 seller reports what became of a payment it took. */
export const SETTLEMENT_HEADER = "PAYMENT-RESPONSE";

/**
 * Where a 402 carries its quote in x402 version 2: the same object as the body, base64 JSON.
 *
 * A version-2 buyer reads it here and may never look at the body. The arc-mandate connector does
 * exactly that, and refused every quote Bench sent until this was set.
 */
export const REQUIRED_HEADER = "PAYMENT-REQUIRED";

/**
 * The headers a payment may arrive in.
 *
 * `Payment-Signature` is what the buyers on Arc send and `X-PAYMENT` is what the x402 specification
 * says. The ecosystem disagrees, and refusing a valid, funded payment over the spelling of a header
 * is the worst failure this code could have — so both are read, and the first one present wins.
 */
export const PAYMENT_HEADERS = ["payment-signature", "x-payment"] as const;
