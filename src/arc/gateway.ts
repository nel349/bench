import type {
  Facilitator, PaymentPayload, PaymentRequirements, SettleResult, VerifyResult,
} from "./facilitator.ts";
import type { Network } from "./chain.ts";

/**
 * Circle Gateway's x402 facilitator, spoken directly.
 *
 * This is deliberately not `@circle-fin/x402-batching`. The shapes below were read out of that
 * package's own compiled client rather than invented — the two endpoints, the request body, the
 * bigint handling and the two response discriminants are all its behaviour, reproduced. What we do
 * not take is the dependency, because everything it adds beyond these sixty lines is hook machinery
 * for a lifecycle we do not have.
 *
 * If that ever stops being true — a signing scheme changes, batching gets cleverer — the right move
 * is to take the dependency, not to keep chasing it here. `Facilitator` is an interface precisely so
 * that swap costs one line.
 */
export const GATEWAY_API: Readonly<Record<Network, string>> = {
  mainnet: "https://gateway-api.circle.com",
  testnet: "https://gateway-api-testnet.circle.com",
};

/** Bigints do not survive `JSON.stringify`, and an amount is always a bigint here. */
const jsonSafe = (v: unknown): unknown =>
  JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export interface GatewayOptions {
  /** Overrides the network default. `GATEWAY_API` in the environment wins over both. */
  readonly url?: string;
  /** Anything the account needs to authenticate. Never logged. */
  readonly headers?: Readonly<Record<string, string>>;
  /** How long to wait before giving up on the facilitator. */
  readonly timeoutMs?: number;
}

export class GatewayFacilitator implements Facilitator {
  readonly #url: string;
  readonly #headers: Record<string, string>;
  readonly #timeoutMs: number;

  constructor(net: Network, opts: GatewayOptions = {}) {
    const url = process.env["GATEWAY_API"] ?? opts.url ?? GATEWAY_API[net];
    this.#url = url.replace(/\/+$/, "");
    this.#headers = { "content-type": "application/json", ...opts.headers };
    this.#timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /** The URL only, never the headers: those are where a key would be. */
  get endpoint(): string { return this.#url; }

  async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResult> {
    const data = await this.#post("verify", payload, requirements);
    if (!isRecord(data) || typeof data["isValid"] !== "boolean") {
      throw new Error("the facilitator's verify response had no isValid");
    }
    return data as unknown as VerifyResult;
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResult> {
    const data = await this.#post("settle", payload, requirements);
    if (!isRecord(data) || typeof data["success"] !== "boolean") {
      throw new Error("the facilitator's settle response had no success");
    }
    return data as unknown as SettleResult;
  }

  /**
   * One call.
   *
   * Everything that goes wrong here throws, and `ArcPayments` turns a throw into `unavailable`
   * rather than a refusal — which is the distinction that matters when the facilitator is down: the
   * buyer's money is fine, and telling them otherwise sends them to debug a wallet with nothing
   * wrong with it. A `4xx` carrying a proper body is *not* a throw; it is the facilitator answering.
   */
  async #post(op: "verify" | "settle", payload: PaymentPayload, requirements: PaymentRequirements): Promise<unknown> {
    const body = JSON.stringify({
      paymentPayload: jsonSafe(payload),
      paymentRequirements: jsonSafe(requirements),
    });

    // Without this a hung facilitator holds the request open until the client gives up, and the
    // agent learns nothing. `AbortSignal.timeout` is in Bun and needs no dependency.
    const res = await fetch(`${this.#url}/v1/x402/${op}`, {
      method: "POST", headers: this.#headers, body,
      signal: AbortSignal.timeout(this.#timeoutMs),
    });

    const text = await res.text();
    if (!text) throw new Error(`the facilitator returned nothing from ${op} (${res.status})`);

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      // The body is not echoed: an error page from a proxy in front of Gateway can carry headers
      // back, and this string reaches a log.
      throw new Error(`the facilitator's ${op} response was not JSON (${res.status})`);
    }
    return data;
  }
}
