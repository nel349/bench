/**
 * One real run against a gym that is already up, paid by an agent from a balance of its own.
 *
 * `real-bounty` and `pay-once` start a gym inside themselves, which proves the code and says
 * nothing about a deployment. This one is a customer: it knows a URL and holds a key, and everything
 * it learns comes back over HTTP or off the chain. It is how a gym on a new network is shown to work
 * end to end, with the gym's own scribe writing the record.
 *
 * The agent is a plain account. It registers an ERC-8004 identity if it is not given one, which
 * names its own address as the identity's wallet; that is what the gym checks before it records
 * anything. It pays from its deposit at Circle's Gateway, which `top-up` fills.
 *
 * **A price is read before it is paid.** Every quote is printed, and one that would take the run
 * past `--most` is refused, not paid. An answer's price depends on how many the address has sent,
 * so the list price is a guess until the gym says.
 *
 * **What was paid is what the gym says was paid.** A record can be paid for and not written, when
 * the gym's scribe cannot reach the chain or has no gas; the gym says so, keeps the payment, and
 * writes it for free when asked again. `--run=<id>` asks again, for a run already solved.
 *
 * Dry by default: it reads balances, prices and the identity, and stops. `--send` is the word that
 * spends.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient, createWalletClient, http, parseAbi, parseEventLogs, formatUnits, getAddress,
  type Hex,
} from "viem";
import { paymentHeader, payableOn } from "../src/chain/buyer.ts";
import { chainOf, contractsOf, rpcUrl, explorerUrl, type Network } from "../src/chain/chain.ts";
import { ArcRegistry, checkIdentity, parseAgentId } from "../src/chain/identity.ts";
import { shortestRoute, type Walls } from "../src/problems/toll.ts";
import { usdc as parseUsdc, format } from "../src/shared/money.ts";
import { PATHS } from "../src/shared/paths.ts";

const net = (process.env["ARC_NETWORK"] ?? "testnet") as Network;
const send = process.argv.includes("--send");
const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const PROBLEM = "toll";
const gym = arg("gym")?.replace(/\/+$/, "");
if (!gym) { console.error("Name the gym: --gym=<its address, like https://bench.example>"); process.exit(1); }

/** The most this run may cost, the record's fee included. Above it a quote is refused. */
const most = parseUsdc(arg("most") ?? "0.50");
/** A run already solved, whose record is asked for again. */
const resume = arg("run");

const keyFile = arg("key-file") ?? join(homedir(), ".arc-mandate", "agent.key");
const raw = readFileSync(keyFile, "utf8").trim();
if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) { console.error(`${keyFile} does not hold a usable key`); process.exit(1); }
const agent = privateKeyToAccount(raw as Hex);

const c = contractsOf(net);
if (!c.erc8004) { console.error(`ERC-8004 is not on ${net}, so a run there cannot be recorded.`); process.exit(1); }
const identityRegistry = getAddress(c.erc8004.identity);

const chain = chainOf(net);
const transport = http(rpcUrl(net));
const pub = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account: agent, chain, transport });

const gateway = parseAbi(["function availableBalance(address token, address depositor) view returns (uint256)"]);
const identityAbi = parseAbi([
  "function register() returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

const call = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) =>
  fetch(gym + path, {
    method, headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

// ── what is there before anything is spent ─────────────────────────────────────────────────────
const gas = await pub.getBalance({ address: agent.address });
const deposit = await pub.readContract({
  address: getAddress(c.gatewayWallet), abi: gateway, functionName: "availableBalance",
  args: [getAddress(c.usdc), agent.address],
}) as bigint;
const about = await (await call("GET", `${PATHS.problems}/${PROBLEM}`)).json() as
  { title: string; prices: { ask: string; submit: string; rank: string } };
const listed = parseUsdc(about.prices.ask) + parseUsdc(about.prices.submit) + parseUsdc(about.prices.rank);

console.log(`network   ${net} (${chain.id})`);
console.log(`gym       ${gym}`);
console.log(`agent     ${agent.address}`);
console.log(`  holds   ${formatUnits(gas, 18)} USDC, which is its gas`);
console.log(`  deposit ${formatUnits(deposit, 6)} USDC at Circle's Gateway, which is what it pays from`);
console.log(`exercise  ${about.title}: a question ${about.prices.ask}, an answer ${about.prices.submit}, the record ${about.prices.rank}`);
console.log(`  at list ${format(listed)} USDC for one question, one answer and the record`);
console.log(`at most   ${format(most)} USDC`);

let agentId = parseAgentId(arg("agent-id"));
const registry = new ArcRegistry(net);
if (agentId !== null) {
  const claim = await checkIdentity(registry, agentId, agent.address);
  console.log(`identity  #${agentId}: ${claim.ok ? "its wallet is this agent" : "NOT this agent's"}`);
  if (!claim.ok) { console.error("\nThat identity does not name this agent as its wallet. Nothing sent."); process.exit(1); }
} else {
  console.log(`identity  none named: one is registered first, from the agent's own address`);
}

if (resume && agentId === null) { console.error("\nWith --run, name the identity the run was started under: --agent-id=<id>"); process.exit(1); }

if (!resume && deposit < listed) {
  console.error(`\nThe deposit is less than the list price. Fill it first:`);
  console.error(`  ARC_NETWORK=${net} bun run top-up --amount=${format(most)} --to=${agent.address} --from-file=<a funded key>`);
  process.exit(1);
}
if (!resume && listed > most) { console.error("\nThe list price is already past --most. Nothing sent."); process.exit(1); }

if (!send) { console.log("\nDry run. Nothing was sent. Add --send to spend."); process.exit(0); }

// ── 1. an identity, if it has none ─────────────────────────────────────────────────────────────
if (agentId === null) {
  console.log("\n1. registering an identity");
  const hash = await wallet.writeContract({
    address: identityRegistry, abi: identityAbi, functionName: "register", chain, account: agent,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  const minted = parseEventLogs({ abi: identityAbi, eventName: "Transfer", logs: receipt.logs })
    .find((log) => getAddress(log.address) === identityRegistry && getAddress(log.args.to) === agent.address);
  if (receipt.status !== "success" || !minted) {
    console.error(`   ${hash}  ${receipt.status}, and no identity came of it. Stopping.`);
    process.exit(1);
  }
  agentId = minted.args.tokenId;
  console.log(`   #${agentId}  ${explorerUrl(net)}/tx/${hash}`);
  const claim = await checkIdentity(registry, agentId, agent.address);
  if (!claim.ok) { console.error("   the registry does not name this agent as its wallet. Stopping."); process.exit(1); }
} else {
  console.log(`\n1. identity #${agentId}, already this agent's`);
}

// ── 2. the run ─────────────────────────────────────────────────────────────────────────────────
const mine = { "x-agent": agent.address, "x-agent-id": agentId.toString() };
let spent = 0n;

/** What a paid route answered: the gym says in every answer what it took, written or not. */
interface Answered { readonly status: number; readonly ok: boolean; readonly body: Record<string, unknown> }

const answeredBy = async (res: Response): Promise<Answered> => {
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (typeof body["paid"] === "string") spent += parseUsdc(body["paid"]);
  return { status: res.status, ok: res.ok, body };
};

/** Pays what a route asks, having said what that is, and refuses a price that would pass the limit. */
async function paid(what: string, path: string, body: unknown): Promise<Answered> {
  const first = await call("POST", path, mine, body);
  if (first.status !== 402) return answeredBy(first);
  const quote = await first.json() as { resource: { url: string; description: string; mimeType: string } };
  const terms = payableOn(net, quote);
  if (!terms) throw new Error(`${what}: the gym's quote cannot be paid on ${net}`);
  const price = BigInt(terms.amount);
  if (spent + price > most) {
    throw new Error(`${what} is quoted at ${format(price)}, which would make ${format(spent + price)}, past the limit of ${format(most)}. Not paid.`);
  }
  console.log(`   ${what}: quoted ${format(price)}, paying`);
  const header = await paymentHeader(agent, net, terms, quote.resource);
  return answeredBy(await call("POST", path, { ...mine, "Payment-Signature": header }, body));
}

const why = (a: Answered): string =>
  `${a.status} ${String(a.body["because"] ?? a.body["reason"] ?? a.body["error"] ?? "")}`.trim();

let runId = resume;
let solvingCost = "?";
if (runId) {
  console.log(`2. run ${runId}, already played`);
} else {
  console.log("2. the run");
  const started = await call("POST", PATHS.attempts, mine, { problem: PROBLEM, budget: format(most) });
  const run = await started.json() as { id?: string; error?: string };
  if (!started.ok || !run.id) { console.error(`   could not start: ${started.status} ${run.error ?? ""}`); process.exit(1); }
  runId = run.id;
  console.log(`   ${runId} started, free`);

  const asked = await paid("the map", `${PATHS.attempts}/${runId}/ask`, { map: true });
  const map = (asked.body["answer"] as { map?: Walls[][] } | undefined)?.map;
  if (!asked.ok || !map) { console.error(`   the map was not sold: ${why(asked)}`); process.exit(1); }

  const route = shortestRoute(map).join("");
  const answered = await paid("the answer", `${PATHS.attempts}/${runId}/submit`, { answer: route });
  const solved = answered.body["solved"] === true;
  console.log(`   ${route}: ${solved ? "solved" : `not solved (${why(answered)})`}`);
  if (!solved) process.exit(1);
  solvingCost = String(answered.body["spend"] ?? "?");
}

// ── 3. the record ──────────────────────────────────────────────────────────────────────────────
console.log("3. the record");
const ranked = await paid("the record", `${PATHS.attempts}/${runId}/rank`, {});
const written = ranked.body["ranked"] === true && typeof ranked.body["tx"] === "string";
if (written) {
  console.log(`   written to identity #${agentId}: ${explorerUrl(net)}/tx/${String(ranked.body["tx"])}`);
} else {
  console.log(`   not written: ${why(ranked)}`);
  console.log(`   to ask again: add --run=${runId} --agent-id=${agentId}`);
}

const rating = await (await call("GET", `${PATHS.rating}/${agentId}`)).json() as { rating?: number };
console.log(`\npaid      ${format(spent)} USDC${resume ? " this time" : ` in all, of which solving cost ${solvingCost}`}`);
console.log(`rep       ${rating.rating ?? "unread"}, as the gym reads it from the chain`);
console.log(`standings ${gym}/#standings`);
if (!written) process.exit(1);
