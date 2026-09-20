/**
 * Sends native USDC — which on Arc is both the money and the gas — to an address that needs to
 * send transactions.
 *
 * The arbiter signs `award()` and nothing else, so it needs gas and no balance beyond it. It is
 * funded separately rather than being given a Gateway deposit: a deposit is what x402 spends, and
 * the arbiter is not buying anything.
 *
 * Dry by default. `--send` is the word that spends.
 */
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http, formatUnits, parseEther, getAddress, type Hex } from "viem";
import { chainOf, rpcUrl, explorerUrl, type Network } from "../src/arc/chain.ts";

const net = (process.env["ARC_NETWORK"] ?? "testnet") as Network;
const send = process.argv.includes("--send");
const to = getAddress(process.argv.find((a) => /^--to=/.test(a))?.split("=")[1] ?? "");
/** Native USDC has 18 decimals, unlike the 6 of its ERC-20 view. A real trap. */
const amount = parseEther(process.argv.find((a) => /^--amount=/.test(a))?.split("=")[1] ?? "0.03");

const chain = chainOf(net);
const pub = createPublicClient({ chain, transport: http(rpcUrl(net)) });
console.log(`to     ${to}`);
console.log(`  has  ${formatUnits(await pub.getBalance({ address: to }), 18)} USDC`);
console.log(`send   ${formatUnits(amount, 18)} USDC`);

if (!send) { console.log("\nDry run. Nothing was sent. Add --send to spend."); process.exit(0); }

const keyEnv = process.argv.find((a) => /^--from-env=/.test(a))?.split("=")[1];
if (!keyEnv) { console.error("Name the funding key: --from-env=<path>:<VAR>"); process.exit(1); }
const [file, name] = keyEnv.split(":");
const raw = new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(file!, "utf8"))?.[1]?.trim();
if (!raw || !/^0x[0-9a-fA-F]{64}$/.test(raw)) { console.error("that key is not usable"); process.exit(1); }

const from = privateKeyToAccount(raw as Hex);
const wallet = createWalletClient({ account: from, chain, transport: http(rpcUrl(net)) });
const before = await pub.getBalance({ address: from.address });
console.log(`from   ${from.address}  has ${formatUnits(before, 18)}`);
if (before < amount) { console.error("the funder holds less than that. Nothing sent."); process.exit(1); }

const hash = await wallet.sendTransaction({ to, value: amount, account: from, chain });
const receipt = await pub.waitForTransactionReceipt({ hash });
console.log(`\n${hash}  ${receipt.status}`);
const after = await pub.getBalance({ address: to });
console.log(`${to} now holds ${formatUnits(after, 18)} USDC`);
console.log(`${explorerUrl(net)}/tx/${hash}`);
