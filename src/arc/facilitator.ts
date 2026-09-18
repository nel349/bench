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
export interface PaymentPayload { readonly x402Version: number; readonly payload: Record<string, unknown> }

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
  isRecord(v) && typeof v["x402Version"] === "number" && isRecord(v["payload"]);
