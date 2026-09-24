/**
 * One real bounty on Arc testnet: funded on chain, refused, earned, ranked, won and paid.
 *
 * Items 12 and 18, and the end-to-end test the unit tests stand in for. Every step touches something
 * real: the escrow is our deployed contract, the payments are Circle's, the rating is an ERC-8004
 * entry the scribe writes to the agent's identity, read back without the gym, and the payout is a
 * transaction hash anyone can look up.
 *
 * Dry by default. `--send` is the word that spends. `--agent-id=<id>` names the ERC-8004 identity
 * whose wallet is the agent key.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient, createWalletClient, http, parseAbi, formatUnits, getAddress, type Hex,
} from "viem";
import { handle, type Deps } from "../src/http.ts";
import { Attempts } from "../src/attempt.ts";
import { MemoryStore } from "../src/store.ts";
import { Bounties } from "../src/bounties.ts";
import { MemoryBounties } from "../src/bounty-store.ts";
import { ArcPayments } from "../src/arc/payments.ts";
import { GatewayFacilitator } from "../src/arc/gateway.ts";
import { ArcArbiter } from "../src/arc/arbiter.ts";
import { ArcEscrow } from "../src/arc/escrow.ts";
import { paymentHeader, payableOn } from "../src/arc/buyer.ts";
import { chainOf, contractsOf, rpcUrl, explorerUrl } from "../src/arc/chain.ts";
import { shortestRoute, type Walls } from "../src/problems/toll.ts";
import { format } from "../src/money.ts";
import { ArcRegistry, checkIdentity, parseAgentId } from "../src/arc/identity.ts";
import { ArcReputation, COST_DECIMALS, COST_TAG, REPUTATION_ABI } from "../src/arc/reputation.ts";
import "../src/problems/blackbox-problem.ts";
import "../src/problems/zendo.ts";
import "../src/problems/toll.ts";

const net = "testnet" as const;
const c = contractsOf(net);
const send = process.argv.includes("--send");
const PORT = Number(process.env["PORT"] ?? 8905);
const SECRET = 424242;
const BOUNTY = 30000n;           // 0.03 USDC
/** Toll is easy, which counts 1, so one ranked Toll run meets the bar. */
const MIN_RATING = 1;

const agent = privateKeyToAccount(readFileSync(join(homedir(), ".arc-mandate", "agent.key"), "utf8").trim() as Hex);
const arbiterKey = readFileSync(join(homedir(), ".bench", "arbiter.key"), "utf8").trim() as Hex;
const scribeKey = readFileSync(join(homedir(), ".bench", "scribe.key"), "utf8").trim() as Hex;
const scribeAddress = privateKeyToAccount(scribeKey).address;
const agentId = parseAgentId(process.argv.find((a) => a.startsWith("--agent-id="))?.split("=")[1]);
if (agentId === null) { console.error("Name the agent's ERC-8004 identity: --agent-id=<id>"); process.exit(1); }
const registry = new ArcRegistry(net);
const verify = async (id: bigint, payer: string) => (await checkIdentity(registry, id, payer)).ok;
const arbiterAddress = privateKeyToAccount(arbiterKey).address;
const escrowAddress = getAddress(c.bountyEscrow!);

const chain = chainOf(net);
const pub = createPublicClient({ chain, transport: http(rpcUrl(net)) });
const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
const escrowAbi = parseAbi([
  "function post(uint256 amount, uint64 deadline) returns (uint256)",
  "function get(uint256 id) view returns ((address poster, uint64 deadline, bool settled, uint256 amount))",
  "function nextId() view returns (uint256)",
]);
const gw = parseAbi(["function availableBalance(address token, address depositor) view returns (uint256)"]);

const deposit = await pub.readContract({ address: c.gatewayWallet as `0x${string}`, abi: gw,
  functionName: "availableBalance", args: [c.usdc as `0x${string}`, agent.address] }) as bigint;

console.log(`escrow   ${escrowAddress}`);
console.log(`arbiter  ${arbiterAddress}`);
console.log(`agent    ${agent.address}  deposit ${formatUnits(deposit, 6)}`);
const owned = await checkIdentity(registry, agentId, agent.address);
const scribeGas = await pub.getBalance({ address: scribeAddress });
console.log(`identity ${agentId}  ${owned.ok ? "names the agent key as its wallet" : `NOT the agent's: ${owned.because}`}`);
console.log(`scribe   ${scribeAddress}  gas ${formatUnits(scribeGas, 18)} USDC`);
console.log(`bounty   ${format(BOUNTY)} USDC, minRating ${MIN_RATING}`);
console.log(`agent needs ~0.32 deposited: 0.02 for the map, 0.25 to rank, 0.05 to attempt the bounty\n`);
if (!owned.ok) process.exit(1);

if (!send) { console.log("Dry run. Nothing was sent. Add --send to spend."); process.exit(0); }

// ── 1. fund the bounty on chain ────────────────────────────────────────────────────────────────
const keyEnv = process.argv.find((a) => /^--poster-env=/.test(a))?.split("=")[1];
if (!keyEnv) { console.error("Name the poster key: --poster-env=<path>:<VAR>"); process.exit(1); }
const [file, name] = keyEnv.split(":");
const rawPoster = new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(file!, "utf8"))?.[1]?.trim();
if (!rawPoster || !/^0x[0-9a-fA-F]{64}$/.test(rawPoster)) { console.error("unusable poster key"); process.exit(1); }
const poster = privateKeyToAccount(rawPoster as Hex);
const posterWallet = createWalletClient({ account: poster, chain, transport: http(rpcUrl(net)) });

console.log("1. funding the bounty on chain");
const deadline = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600);
const approveHash = await posterWallet.writeContract({
  address: c.usdc as `0x${string}`, abi: erc20, functionName: "approve",
  args: [escrowAddress, BOUNTY], account: poster, chain,
});
await pub.waitForTransactionReceipt({ hash: approveHash });
const escrowId = await pub.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "nextId" }) as bigint;
const postHash = await posterWallet.writeContract({
  address: escrowAddress, abi: escrowAbi, functionName: "post",
  args: [BOUNTY, deadline], account: poster, chain,
});
await pub.waitForTransactionReceipt({ hash: postHash });
const held = await pub.readContract({ address: c.usdc as `0x${string}`, abi: erc20, functionName: "balanceOf", args: [escrowAddress] }) as bigint;
console.log(`   escrow bounty #${escrowId}, escrow now holds ${formatUnits(held, 6)} USDC`);
console.log(`   ${explorerUrl(net)}/tx/${postHash}\n`);

// ── 2. the gym, pointed at all of it ───────────────────────────────────────────────────────────
const facilitator = new GatewayFacilitator(net);
const payments = new ArcPayments(facilitator, net, poster.address, () => 0n);
const store = new MemoryStore();
const bounties = new Bounties(new MemoryBounties());
const reputation = new ArcReputation(net, scribeKey);
const deps: Deps = {
  attempts: new Attempts(payments, store, verify), payments, net, bounties,
  reputation, verifyIdentity: verify,
  arbiter: new ArcArbiter(net, { escrow: escrowAddress, privateKey: arbiterKey }),
  // The listing is now checked against the chain, so the run proves that too.
  escrow: new ArcEscrow(net, escrowAddress),
};
const server = Bun.serve({ port: PORT, fetch: (req) => handle(req, deps) });
const base = `http://localhost:${PORT}`;
const mine = { "x-agent": agent.address, "x-agent-id": agentId.toString(), "content-type": "application/json" };
const call = (m: string, p: string, h: Record<string, string>, b?: unknown) =>
  fetch(base + p, { method: m, headers: h, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });

/** Pays whatever a route asks for, the way any x402 buyer would. */
async function paid(path: string, body: unknown): Promise<Response> {
  const first = await call("POST", path, mine, body);
  if (first.status !== 402) return first;
  const quote = await first.json() as { resource: { url: string; description: string; mimeType: string } };
  const terms = payableOn(net, quote);
  if (!terms) throw new Error(`unpayable quote for ${path}`);
  const header = await paymentHeader(agent, net, terms, quote.resource);
  return call("POST", path, { ...mine, "Payment-Signature": header }, body);
}

try {
  const gymBounty = await (await call("POST", "/bounties", mine, {
    title: "Name the constant", statement: "Return the number we are thinking of.",
    amount: format(BOUNTY), deadline: Date.now() + 7 * 24 * 3600_000, minRating: MIN_RATING,
    escrowId: escrowId.toString(), checker: { kind: "equals", value: SECRET },
  })).json() as { id: string };
  console.log(`2. gym bounty ${gymBounty.id}, backed by escrow #${escrowId}`);
  console.log(`   poster read from the chain: ${(gymBounty as { poster?: string }).poster}\n`);

  // ── 3. refused, and it costs nothing ─────────────────────────────────────────────────────────
  console.log("3. attempting it with no record");
  const cold = await call("POST", `/bounties/${gymBounty.id}/solve`, mine, { answer: SECRET });
  const coldBody = await cold.json() as { rating: number; needs: number; charged: boolean };
  console.log(`   ${cold.status}  rating ${coldBody.rating}, needs ${coldBody.needs}, charged: ${coldBody.charged}\n`);

  // ── 4. earn the rating, by actually solving something ────────────────────────────────────────
  console.log("4. earning a rating: solving Toll");
  // Solved from the map it pays for. The seed is the gym's, and secret until the run is over.
  const run = await (await call("POST", "/attempts", mine, { problem: "toll" })).json() as { id: string };
  const bought = await (await paid(`/attempts/${run.id}/ask`, { map: true })).json() as { answer: { map: Walls[][] } };

  const route = shortestRoute(bought.answer.map);
  const solved = await (await paid(`/attempts/${run.id}/submit`, { answer: route.join("") })).json() as { solved: boolean };
  console.log(`   solved: ${solved.solved}`);

  const rankedRun = await (await paid(`/attempts/${run.id}/rank`, {})).json() as { ranked: boolean; tx?: string; because?: string };
  console.log(`   ranked: ${rankedRun.ranked}  ${rankedRun.tx ? `${explorerUrl(net)}/tx/${rankedRun.tx}` : rankedRun.because}`);

  // Read back as a stranger would: straight from the registry, filtered to the scribe, no gym involved.
  const [, , values, , tag1s] = await pub.readContract({
    address: c.erc8004!.reputation as `0x${string}`, abi: REPUTATION_ABI, functionName: "readAllFeedback",
    args: [agentId, [scribeAddress], "", COST_TAG, false],
  });
  console.log(`   on chain, by the scribe: ${tag1s.map((t, i) => `${t} ${formatUnits(values[i]!, COST_DECIMALS)}`).join(", ")}`);
  const rating = await (await call("GET", `/rating/${agentId}`, mine)).json() as { rating: number };
  console.log(`   rating now ${rating.rating}\n`);

  // ── 5. win it ────────────────────────────────────────────────────────────────────────────────
  console.log("5. attempting it again, with a record");
  const won = await (await paid(`/bounties/${gymBounty.id}/solve`, { answer: SECRET })).json() as
    { solved: boolean; solver: string; payout?: { ok: boolean; tx?: string; because?: string } };
  console.log(`   solved: ${won.solved}  solver ${won.solver}`);
  console.log(`   payout: ${JSON.stringify(won.payout)}`);
  if (won.payout?.tx) console.log(`   ${explorerUrl(net)}/tx/${won.payout.tx}`);

  // ── 6. did the money move? ───────────────────────────────────────────────────────────────────
  const after = await pub.readContract({ address: c.usdc as `0x${string}`, abi: erc20, functionName: "balanceOf", args: [escrowAddress] }) as bigint;
  const solverBalance = await pub.readContract({ address: c.usdc as `0x${string}`, abi: erc20, functionName: "balanceOf", args: [agent.address] }) as bigint;
  console.log(`\n6. on chain`);
  console.log(`   escrow holds ${formatUnits(after, 6)} (was ${formatUnits(held, 6)})`);
  console.log(`   solver holds ${formatUnits(solverBalance, 6)}`);
  console.log(after < held && solverBalance >= BOUNTY ? "\n✓ the bounty was paid." : "\n✗ the money did not move.");
} finally {
  server.stop(true);
}
