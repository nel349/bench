/**
 * Creates the gym's arbiter key, once, and never overwrites one.
 *
 * The arbiter is the address trusted to name a bounty's winner, and it must not be the agent that
 * solves bounties — an arbiter awarding to itself is exactly the residual trust `BountyEscrow`
 * documents, and there is no reason to hand it that.
 *
 * It is also a **constructor argument**, so it is part of the escrow's CREATE2 address: the same
 * arbiter on testnet and mainnet is what makes the two deployments share an address. Keep this key.
 *
 * Stored the way the mandate stores its agent key: 0600 in a 0700 directory, outside any repository.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const PATH = process.env["BENCH_ARBITER_KEY_PATH"] ?? join(homedir(), ".bench", "arbiter.key");

if (existsSync(PATH)) {
  const account = privateKeyToAccount(readFileSync(PATH, "utf8").trim() as `0x${string}`);
  console.log(`arbiter already exists: ${account.address}`);
  console.log(`  ${PATH}`);
  process.exit(0);
}

mkdirSync(dirname(PATH), { recursive: true, mode: 0o700 });
const key = generatePrivateKey();
writeFileSync(PATH, `${key}\n`, { mode: 0o600 });
chmodSync(PATH, 0o600);

console.log(`arbiter created: ${privateKeyToAccount(key).address}`);
console.log(`  ${PATH}`);
console.log(`\nKeep it. It is a constructor argument, so the escrow's address depends on it —`);
console.log(`a different arbiter on mainnet means a different address there.`);
