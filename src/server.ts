import { handle, type Deps } from "./http.ts";
import { Attempts } from "./attempt.ts";
import { InMemoryAllowance } from "./payments.ts";
import { MemoryStore, SqliteStore } from "./store.ts";
import { usdc } from "./money.ts";
import { network, requireContracts } from "./arc/chain.ts";

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
 * Allowances held in memory, which is the whole of the payment story until x402 is wired in.
 *
 * `DEV_ALLOWANCE` grants every agent the same budget the first time it appears. It exists so the
 * flow can be walked with curl, and it is **refused on mainnet** — an allowance that costs nobody
 * anything is a fine thing to develop against and a lie to run a gym on.
 */
const money = new InMemoryAllowance();
const devAllowance = process.env["DEV_ALLOWANCE"];
if (devAllowance && net === "mainnet") {
  throw new Error("DEV_ALLOWANCE is for testnet. On mainnet an allowance comes from the chain.");
}

/**
 * Runs are kept on disk by default. A gym whose leaderboard resets on deploy is not one.
 *
 * `BENCH_DB=:memory:` opts out, which is for a throwaway process and never for anything anyone is
 * expected to come back to.
 */
const store = process.env["BENCH_DB"] === ":memory:" ? new MemoryStore() : new SqliteStore();
const attempts = new Attempts(money, store);
const deps: Deps = { attempts, payments: money, net };

const port = Number(process.env["PORT"] ?? 8791);

Bun.serve({
  port,
  fetch(req) {
    // Dev only: anyone who names an agent gets a budget, so the flow can be walked without a wallet.
    if (devAllowance) {
      const agent = req.headers.get("x-agent");
      if (agent && money.capOf(agent) === 0n) money.grant(agent, usdc(devAllowance));
    }
    return handle(req, deps);
  },
});

const kept = store instanceof SqliteStore ? process.env["BENCH_DB"] ?? "bench.sqlite" : "memory (nothing is kept)";
console.log(
  `bench listening on :${port}  network=${net}  runs=${kept}` +
  `${devAllowance ? `  DEV_ALLOWANCE=$${devAllowance}` : ""}`,
);
