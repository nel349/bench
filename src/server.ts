import { handle, type Deps } from "./http.ts";
import { Attempts } from "./attempt.ts";
import { Bounties } from "./bounties.ts";
import { MemoryBounties, SqliteBounties } from "./bounty-store.ts";
import { InMemoryAllowance, type Payments } from "./payments.ts";
import { MemoryStore, SqliteStore } from "./store.ts";
import { usdc } from "./money.ts";
import { contractsOf, network, requireContracts } from "./arc/chain.ts";
import { ArcPayments } from "./arc/payments.ts";
import { GatewayFacilitator } from "./arc/gateway.ts";
import { ArcRegistry, checkIdentity } from "./arc/identity.ts";
import { ArcAllowances } from "./arc/allowance.ts";
import { ArcArbiter, arbiterKey } from "./arc/arbiter.ts";
import { ArcEscrow } from "./arc/escrow.ts";
import { ArcReputation } from "./arc/reputation.ts";
import { paidBy } from "./rating.ts";
import { privateKeyFrom } from "./arc/keys.ts";
import { ArcFunds } from "./arc/funds.ts";
import { PRICE } from "./pricing.ts";
import { DEFAULT_PORT } from "./paths.ts";

/**
 * The process. Everything it needs is decided here and nowhere else.
 *
 * `requireContracts` runs before a socket is opened, so a misconfigured network fails at startup
 * with a sentence naming what is missing — rather than at the first paid request, a long way from
 * the cause and wearing the wrong clothes.
 */
const net = network();

/**
 * Ratings are not written on chain yet, so this asks only for what it uses. When they are, flip
 * `onChainRatings` and the guard starts insisting on the registries too.
 */
requireContracts(net, { allowance: false, onChainRatings: false });

/**
 * Who takes the money.
 *
 * Two of them, and which one is running is the single most important fact about a process, so it is
 * decided here, once, from the environment, and printed on the first line of the log.
 *
 * `BENCH_PAY_TO` is the address a quote points at. Setting it turns on real x402: a 402 carries a
 * quote an agent can actually sign, and Circle Gateway verifies and settles it. Leaving it unset
 * falls back to the in-memory allowance, which is for walking the flow with curl.
 *
 * On mainnet the in-memory allowance is **refused**. An allowance that costs nobody anything is a
 * fine thing to develop against and a lie to run a gym on.
 */
const payTo = process.env["BENCH_PAY_TO"];
const devAllowance = process.env["DEV_ALLOWANCE"];

if (devAllowance && net === "mainnet") {
  throw new Error("DEV_ALLOWANCE is for testnet. On mainnet an allowance comes from the chain.");
}
if (!payTo && net === "mainnet") {
  throw new Error(
    "BENCH_PAY_TO must name the address that receives payment before this serves mainnet. " +
    "Without it nothing could be charged, and every problem would silently be free.",
  );
}
if (payTo && !/^0x[0-9a-fA-F]{40}$/.test(payTo)) {
  throw new Error(`BENCH_PAY_TO is not an address: ${payTo}`);
}

const money = new InMemoryAllowance();

/**
 * Runs are kept on disk by default. A gym whose leaderboard resets on deploy is not one.
 *
 * `BENCH_DB=:memory:` opts out, which is for a throwaway process and never for anything anyone is
 * expected to come back to.
 */
const store = process.env["BENCH_DB"] === ":memory:" ? new MemoryStore() : new SqliteStore();

/**
 * What an agent has spent, summed from the record rather than from a counter.
 *
 * `ArcPayments` deliberately keeps no tally of its own: the allowance lives in a session key on the
 * agent's account and the chain is what enforces it, so a second number here could only ever be a
 * second opinion about somebody else's money — right up until the two disagreed.
 *
 * Runs bind to the address that paid for them, so spend is summed over the payer. A run nobody
 * paid for spent nothing and belongs to nobody.
 */
const spentBy = (agent: string): bigint =>
  // `paidBy`, so an address is the same account whatever its case. An exact comparison here reported
  // $0.00 for an agent that had spent real money, because payers are stored lowercase and a record is
  // looked up by whatever case the caller used. The functional test on testnet found it.
  paidBy(store.all(), agent).reduce((total, a) => total + a.spend, 0n);

const payments: Payments = payTo
  ? new ArcPayments(new GatewayFacilitator(net, {
      ...(process.env["GATEWAY_KEY"] ? { headers: { authorization: `Bearer ${process.env["GATEWAY_KEY"]}` } } : {}),
    }), net, payTo, spentBy)
  : money;

/**
 * Identities, checked only where there is a registry to check them against.
 *
 * ERC-8004 is deployed on testnet and not on mainnet, so this is `null` there until the registries
 * go up — and a null verifier means a claimed id stays a claim. That is the honest failure: runs
 * still score under the address that paid, which was always the part that could not be faked.
 */
const identities = contractsOf(net).erc8004 && payTo
  ? (() => {
      const registry = new ArcRegistry(net);
      return async (agentId: bigint, payer: string) => (await checkIdentity(registry, agentId, payer)).ok;
    })()
  : null;

const attempts = new Attempts(payments, store, identities);
/**
 * Bounties, always on.
 *
 * The first version enabled these only when `BENCH_PAY_TO` was set, reasoning that a bounty with no
 * escrow behind it cannot be paid out. True, and the wrong place to enforce it: mainnet already
 * refuses to start without a payee, so the check bought nothing there — and on a dev machine it
 * made the whole posting flow unreachable, which is exactly where it needs to be walked.
 */
const bounties = new Bounties(
  process.env["BENCH_DB"] === ":memory:" ? new MemoryBounties() : new SqliteBounties(),
);

/**
 * The allowance reader, where there is a plugin to read. On a network without one this stays absent
 * and the route says so, rather than inventing a number the chain would not agree with.
 */
const allowances = contractsOf(net).sessionKeyPlugin ? new ArcAllowances(net) : undefined;

/**
 * The arbiter, where a key is configured to sign a payout.
 *
 * Both halves are required or neither is used: a key with no escrow has nothing to pay from, and an
 * escrow with no key cannot be told to pay. Absent, bounties still run and a win is recorded — it
 * simply shows as awaiting payout, which is honest and retryable, rather than silently never paid.
 *
 * The key is read once here and never logged. Only the address it derives is ever printed.
 */
const escrow = process.env["BENCH_ESCROW"];
const key = arbiterKey(process.env["BENCH_ARBITER_KEY"]);
if (escrow && !/^0x[0-9a-fA-F]{40}$/.test(escrow)) {
  throw new Error(`BENCH_ESCROW is not an address: ${escrow}`);
}
const arbiter = escrow && key
  ? new ArcArbiter(net, { escrow: escrow as `0x${string}`, privateKey: key })
  : undefined;

/**
 * Reads the escrow so a bounty cannot claim money that is not there.
 *
 * The same contract the arbiter pays from. It used to read the configured address while payouts
 * went to `BENCH_ESCROW`: identical on testnet, so nothing noticed, and on any other deployment a
 * bounty would have been checked against one contract and paid from another. `demo:local` found it.
 */
const escrowAt = (escrow as `0x${string}` | undefined) ?? contractsOf(net).bountyEscrow;
const escrowReader = escrowAt ? new ArcEscrow(net, escrowAt) : undefined;

/**
 * Ranked runs, written to ERC-8004 by the scribe, where there is a registry and a key to sign with.
 *
 * The scribe is its own key, not the arbiter's, so a leak of one cannot fake the other's authority.
 * It needs identities on as well: a record is written to an identity, and only a proven one. Absent,
 * nothing can be ranked and no bounty can require a record, and the routes say so.
 */
const scribeKey = privateKeyFrom("BENCH_SCRIBE_KEY", process.env["BENCH_SCRIBE_KEY"]);
const reputation = contractsOf(net).erc8004 && identities && scribeKey
  ? new ArcReputation(net, scribeKey)
  : undefined;

/** Reads an agent's balances for the funding page. Needs only a public RPC. */
const funds = new ArcFunds(net, PRICE.ask);

const deps: Deps = {
  attempts, payments, net, bounties, funds,
  ...(allowances ? { allowances } : {}), ...(arbiter ? { arbiter } : {}),
  ...(escrowReader ? { escrow: escrowReader } : {}),
  ...(reputation ? { reputation } : {}), ...(identities ? { verifyIdentity: identities } : {}),
};

const port = Number(process.env["PORT"] ?? DEFAULT_PORT);

const server = Bun.serve({
  port,
  fetch(req) {
    // Dev only: anyone who names an agent gets a budget, so the flow can be walked without a wallet.
    if (devAllowance && !payTo) {
      const agent = req.headers.get("x-agent");
      if (agent && money.capOf(agent) === 0n) money.grant(agent, usdc(devAllowance));
    }
    return handle(req, deps);
  },
});

const kept = store instanceof SqliteStore ? process.env["BENCH_DB"] ?? "bench.sqlite" : "memory (nothing is kept)";
// The payee is printed; the key never is. Whether money is real is the first thing to know.
const paying = payTo ? `x402 → ${payTo}` : "in-memory allowance (NOT real money)";
const ids = identities ? "ERC-8004 checked" : "ERC-8004 off (claims stay claims)";
// The address, never the key.
const paying2 = arbiter ? `escrow ${escrow} via ${arbiter.address}` : "no arbiter (wins recorded, not paid)";
const ranking = reputation ? `ranked runs written by ${reputation.scribe}` : "ranking off (no registry or no scribe key)";
/**
 * Finish what is in flight before going.
 *
 * A deploy sends SIGTERM and a container runtime kills the process shortly after. Without this the
 * kill lands mid-request — and a request that has already settled a payment at Circle but not yet
 * written its answer is money taken for nothing, which the agent has no way to tell from a refusal.
 *
 * `stop(false)` stops accepting and lets open requests finish. The second signal is the operator
 * insisting, and is obeyed.
 */
let leaving = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (leaving) {
      console.log(`\n${signal} again — leaving now, mid-request.`);
      process.exit(130);
    }
    leaving = true;
    console.log(`\n${signal} — finishing what is in flight, then leaving.`);
    void server.stop(false).then(() => process.exit(0));
  });
}

console.log(
  `bench listening on :${port}  network=${net}  runs=${kept}  payments=${paying}  identity=${ids}` +
  `  bounties=${paying2}  ${ranking}` +
  `${devAllowance && !payTo ? `  DEV_ALLOWANCE=$${devAllowance}` : ""}`,
);
