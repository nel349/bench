import { handle, type Deps } from "./http.ts";
import { Attempts } from "./attempt.ts";
import { InMemoryAllowance, type Payments } from "./payments.ts";
import { MemoryStore, SqliteStore } from "./store.ts";
import { usdc } from "./money.ts";
import { contractsOf, network, requireContracts } from "./arc/chain.ts";
import { ArcPayments } from "./arc/payments.ts";
import { GatewayFacilitator } from "./arc/gateway.ts";
import { ArcRegistry, checkIdentity } from "./arc/identity.ts";

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
 * Runs bind to the address that paid for them, so spend is summed over the payer, falling back to
 * the header for runs that predate a payment.
 */
const spentBy = (agent: string): bigint =>
  store.all()
    .filter((a) => (a.payer ?? a.agent) === agent)
    .reduce((total, a) => total + a.spend, 0n);

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
const deps: Deps = { attempts, payments, net };

const port = Number(process.env["PORT"] ?? 8791);

Bun.serve({
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
console.log(
  `bench listening on :${port}  network=${net}  runs=${kept}  payments=${paying}  identity=${ids}` +
  `${devAllowance && !payTo ? `  DEV_ALLOWANCE=$${devAllowance}` : ""}`,
);
