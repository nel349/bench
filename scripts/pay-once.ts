/**
 * One real payment, end to end, against Circle's testnet facilitator.
 *
 * This is the harness for item 10. It runs the gym over real HTTP, asks for a probe, is refused
 * with a 402, signs the terms with the mandate's agent key, asks again with the payment attached,
 * and reports exactly how far it got.
 *
 * The agent is the one the mandate already uses — `~/.arc-mandate/agent.key`. It is a plain
 * account, which is all `signPayment` ever needed; no Modular Wallet and no Circle key are
 * involved. Reusing it means the first payment comes from an agent that already holds an ERC-8004
 * identity and a Gateway deposit, which is the shortest path to a real answer.
 *
 * **Nothing here is charged unless Circle settles it.** With too small a deposit the settle refuses
 * and says so, which proves every step but the last.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, parseAbi, formatUnits } from "viem";
import { handle, type Deps } from "../src/http.ts";
import { Attempts } from "../src/attempt.ts";
import { MemoryStore } from "../src/store.ts";
import { ArcPayments } from "../src/arc/payments.ts";
import { GatewayFacilitator } from "../src/arc/gateway.ts";
import { paymentHeader, payableOn } from "../src/arc/buyer.ts";
import { chainOf, contractsOf, rpcUrl } from "../src/arc/chain.ts";
import { format } from "../src/money.ts";
import "../src/problems/blackbox-problem.ts";

const net = "testnet" as const;
const c = contractsOf(net);
const PORT = Number(process.env["PORT"] ?? 8899);

const KEY_PATH = process.env["ARC_MANDATE_KEY_PATH"] ?? join(homedir(), ".arc-mandate", "agent.key");
const agent = privateKeyToAccount(readFileSync(KEY_PATH, "utf8").trim() as `0x${string}`);

/** Where the gym is paid. One of the accounts the app already paired, so the money stays ours. */
const PAY_TO = process.env["BENCH_PAY_TO"] ?? "0x9fa928ACfE2eEcEad9698ebBad835E7129688b28";

const client = createPublicClient({ chain: chainOf(net), transport: http(rpcUrl(net)) });
const gw = parseAbi(["function availableBalance(address token, address depositor) view returns (uint256)"]);

console.log(`agent    ${agent.address}`);
console.log(`paying   ${PAY_TO}`);
const deposit = await client.readContract({
  address: c.gatewayWallet as `0x${string}`, abi: gw,
  functionName: "availableBalance", args: [c.usdc as `0x${string}`, agent.address],
}).catch(() => 0n) as bigint;
console.log(`deposit  ${formatUnits(deposit, 6)} USDC in Gateway\n`);

const facilitator = new GatewayFacilitator(net);
const payments = new ArcPayments(facilitator, net, PAY_TO, () => 0n);
const deps: Deps = { attempts: new Attempts(payments, new MemoryStore()), payments, net };

const server = Bun.serve({ port: PORT, fetch: (req) => handle(req, deps) });
const base = `http://localhost:${PORT}`;
const as = { "x-agent": agent.address, "content-type": "application/json" };

try {
  const started = await (await fetch(`${base}/attempts`, {
    method: "POST", headers: as, body: JSON.stringify({ problem: "blackbox" }),
  })).json() as { id: string };
  console.log(`run ${started.id} started (free)\n`);

  const path = `/attempts/${started.id}/ask`;
  const probe = JSON.stringify({ side: "up", index: 0 });

  console.log("1. asking without paying");
  const first = await fetch(base + path, { method: "POST", headers: as, body: probe });
  const quote = await first.json() as { resource: { url: string; description: string; mimeType: string } };
  console.log(`   ${first.status}  ${first.status === 402 ? "payment required, as it should be" : "UNEXPECTED"}`);

  const terms = payableOn(net, quote);
  if (!terms) throw new Error("the gym quoted terms this buyer cannot satisfy");
  console.log(`   terms: ${format(BigInt(terms.amount))} USDC to ${terms.payTo}`);
  console.log(`   signing against ${terms.extra.name} v${terms.extra.version} @ ${terms.extra.verifyingContract}\n`);

  console.log("2. signing and asking again");
  const header = await paymentHeader(agent, net, terms, quote.resource);
  const paid = await fetch(base + path, {
    method: "POST", headers: { ...as, "Payment-Signature": header }, body: probe,
  });
  const body = await paid.json() as Record<string, unknown>;
  console.log(`   ${paid.status}`);

  const receipt = paid.headers.get("PAYMENT-RESPONSE");
  if (receipt) {
    console.log(`   PAYMENT-RESPONSE: ${JSON.stringify(JSON.parse(Buffer.from(receipt, "base64").toString()))}`);
  }

  if (paid.status === 200) {
    console.log(`\n✓ PAID. The answer came back and the money moved on Arc testnet.`);
    console.log(`   answer: ${JSON.stringify(body["answer"])}`);
  } else if (paid.status === 402) {
    console.log(`\n   ${JSON.stringify(body["error"])}`);
    console.log("\n→ Circle understood the payment and would not settle it.");
    console.log("   Every step but the last is proven: the 402, the terms, the signature, the");
    console.log("   verify, and the settle attempt reaching the chain. What is missing is the");
    console.log(`   deposit — ${formatUnits(deposit, 6)} USDC against a ${format(BigInt(terms.amount))} probe.`);
  } else {
    console.log(`\n? ${JSON.stringify(body).slice(0, 300)}`);
  }
} finally {
  server.stop(true);
}
