/**
 * Creates the gym's scribe key, once, and never overwrites one.
 *
 * The scribe signs the ERC-8004 feedback a ranked run writes. Its address is the one a poster names
 * when reading an agent's rating, so it is the gym's signature on every record. It is its own key,
 * not the arbiter's: a leak of one must not let anyone fake the other's authority.
 *
 * Unlike the arbiter it is not part of any contract's address, so it can be replaced. Replacing it
 * orphans every record written so far, though, since readers filter by it. Keep it.
 *
 * Stored the way the arbiter is: 0600 in a 0700 directory, outside any repository.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const PATH = process.env["BENCH_SCRIBE_KEY_PATH"] ?? join(homedir(), ".bench", "scribe.key");

if (existsSync(PATH)) {
  const account = privateKeyToAccount(readFileSync(PATH, "utf8").trim() as `0x${string}`);
  console.log(`scribe already exists: ${account.address}`);
  console.log(`  ${PATH}`);
  process.exit(0);
}

mkdirSync(dirname(PATH), { recursive: true, mode: 0o700 });
const key = generatePrivateKey();
writeFileSync(PATH, `${key}\n`, { mode: 0o600 });
chmodSync(PATH, 0o600);

console.log(`scribe created: ${privateKeyToAccount(key).address}`);
console.log(`  ${PATH}`);
console.log(`\nIt pays gas for every ranked run, so it needs a little USDC on Arc.`);
console.log(`Keep it: readers filter by its address, and a new scribe starts every record from nothing.`);
