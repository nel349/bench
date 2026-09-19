/**
 * Asks Circle's real testnet facilitator whether it understands what we send it.
 *
 * Everything in `gateway.ts` was written by reading Circle's compiled client, and every test of it
 * stubs `fetch`. This is the first thing that actually speaks to them.
 *
 * It signs with a throwaway key that holds nothing, so the expected answer is a refusal — and the
 * *reason* is the whole point. A refusal about funds means our endpoint, our requirements, our
 * payload and our signature were all understood, and the only thing missing is money. A refusal
 * about the network or the shape means something we believe is wrong.
 *
 * Costs nothing and needs no key. Not part of `gate`: it touches the network.
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getAddress, toHex } from "viem";
import { randomBytes } from "node:crypto";
import { GatewayFacilitator } from "../src/arc/gateway.ts";
import { chainOf, contractsOf, caip2 } from "../src/arc/chain.ts";
import { ArcPayments } from "../src/arc/payments.ts";
import { type PaymentPayload } from "../src/arc/facilitator.ts";
import { payloadFor, type AcceptedTerms } from "../src/arc/buyer.ts";
import { PRICE } from "../src/pricing.ts";
import { format } from "../src/money.ts";

const net = "testnet" as const;
const c = contractsOf(net);
const PAY_TO = "0x000000000000000000000000000000000000bEEF";
const RESOURCE = { url: "https://bench.test/attempts/a1/ask", description: "One probe on Black Box", mimeType: "application/json" };

const agent = privateKeyToAccount(generatePrivateKey());
console.log(`signing as a throwaway account that holds nothing: ${agent.address}`);
console.log(`asking to pay ${format(PRICE.ask)} USDC on ${caip2(net)}\n`);

// The quote the gym would actually send, built by the gym's own code rather than by hand.
const facilitator = new GatewayFacilitator(net);
const payments = new ArcPayments(facilitator, net, PAY_TO, () => 0n);
const requirements = payments.requirements(PRICE.ask);
console.log("requirements we advertise:");
console.log(JSON.stringify(requirements, null, 2).replace(/^/gm, "  "), "\n");

/** The buyer half, matching the mandate's connector: EIP-712, backdated, valid for over a week. */
const now = Math.floor(Date.now() / 1000);
const authorization = {
  from: getAddress(agent.address),
  to: getAddress(PAY_TO),
  value: requirements.amount,
  validAfter: String(now - 600),
  validBefore: String(now + Number(requirements.maxTimeoutSeconds) + 100),
  nonce: toHex(randomBytes(32)),
};

const signature = await agent.signTypedData({
  domain: {
    name: "GatewayWalletBatched",
    version: "1",
    chainId: chainOf(net).id,
    verifyingContract: getAddress(c.gatewayWallet),
  },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType: "TransferWithAuthorization",
  message: {
    from: authorization.from, to: authorization.to,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce as `0x${string}`,
  },
});

const payload: PaymentPayload = payloadFor(
  requirements as unknown as AcceptedTerms, RESOURCE, authorization, signature,
);

console.log(`facilitator: ${facilitator.endpoint}`);
console.log("calling /v1/x402/verify with no credentials at all...\n");

try {
  const verdict = await facilitator.verify(payload, requirements);
  console.log("it answered:", JSON.stringify(verdict, null, 2));

  const reason = (verdict.invalidReason ?? "").toLowerCase();
  if (verdict.isValid) {
    console.log("\n✓ Our shapes are accepted: endpoint, requirements, payload, resource and signature.");
    console.log("  It also said VALID for an account holding nothing and with no Gateway deposit —");
    console.log("  verify checks the signature and the terms, NOT the balance. A seller that served");
    console.log("  on a successful verify would give away everything it sells to anyone who can sign.");
    console.log("  Only settle moves money, which is why ArcPayments does both, in that order.");
  } else if (/fund|balance|insufficient|escrow|deposit/.test(reason)) {
    console.log("\n✓ Understood us, and refused for want of money.");
    console.log("  Endpoint, requirements, payload and signature all accepted. What is missing is a deposit.");
  } else if (/network|scheme|unsupported/.test(reason)) {
    console.log("\n✗ It did not accept what we advertise. The requirements shape or the network is wrong.");
  } else {
    console.log("\n? Refused for a reason we did not anticipate. That reason is the finding.");
  }
  console.log(`\nAlso proven: the facilitator took this with no API key. Nothing was sent but the payload.`);
} catch (e) {
  console.log("it did not answer in the shape we expect:");
  console.log(" ", e instanceof Error ? e.message : String(e));

  /**
   * The raw body, shown only here.
   *
   * `GatewayFacilitator` deliberately never returns or logs it, because a response from a proxy in
   * front of Gateway can carry headers back. This request has no credential in it at all — the
   * whole point of the probe — so there is nothing here to leak, and what Circle actually said is
   * the only thing that moves this forward.
   */
  const res = await fetch(`${facilitator.endpoint}/v1/x402/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paymentPayload: payload, paymentRequirements: requirements }),
  });
  console.log(`\nraw: HTTP ${res.status} ${res.statusText}`);
  console.log(`content-type: ${res.headers.get("content-type")}`);
  const text = await res.text();
  console.log("body:", text.slice(0, 1200));
}
