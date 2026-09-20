/**
 * Deploys `BountyEscrow` through the CREATE2 factory, so testnet and mainnet share an address.
 *
 * In TypeScript rather than `forge script` for one reason: the funding key stays inside the process
 * and never appears on a command line, in shell history, or in a process list.
 *
 * Dry by default. `--send` is the word that spends.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient, createWalletClient, http, encodeAbiParameters, keccak256,
  concat, getAddress, formatUnits, type Address, type Hex,
} from "viem";
import { chainOf, contractsOf, rpcUrl, explorerUrl, type Network } from "../src/arc/chain.ts";

const net = (process.env["ARC_NETWORK"] ?? "testnet") as Network;
const send = process.argv.includes("--send");
const c = contractsOf(net);

/** Arachnid's factory: the same address on every chain that has it, checked before we rely on it. */
const FACTORY: Address = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const SALT = keccak256(new TextEncoder().encode("bench.BountyEscrow.v1"));

const artifact = JSON.parse(readFileSync(
  new URL("../contracts/out/BountyEscrow.sol/BountyEscrow.json", import.meta.url), "utf8",
)) as { bytecode: { object: Hex } };

const arbiterPath = process.env["BENCH_ARBITER_KEY_PATH"] ?? join(homedir(), ".bench", "arbiter.key");
const arbiter = privateKeyToAccount(readFileSync(arbiterPath, "utf8").trim() as Hex).address;

const initCode = concat([
  artifact.bytecode.object,
  encodeAbiParameters(
    [{ type: "address" }, { type: "address" }],
    [getAddress(c.usdc), getAddress(arbiter)],
  ),
]);

/** Where CREATE2 puts it, computable before anything is sent. */
const predicted = getAddress(`0x${keccak256(
  concat(["0xff", FACTORY, SALT, keccak256(initCode)]),
).slice(-40)}`);

const chain = chainOf(net);
const pub = createPublicClient({ chain, transport: http(rpcUrl(net)) });

console.log(`network      ${net} (${chain.id})`);
console.log(`token        ${c.usdc}`);
console.log(`arbiter      ${arbiter}`);
console.log(`salt         ${SALT}`);
console.log(`predicted    ${predicted}`);

const already = await pub.getCode({ address: predicted });
if (already && already !== "0x") {
  console.log(`\nalready deployed, ${(already.length - 2) / 2} bytes. Nothing to do.`);
  console.log(`${explorerUrl(net)}/address/${predicted}`);
  process.exit(0);
}

const factoryCode = await pub.getCode({ address: FACTORY });
if (!factoryCode || factoryCode === "0x") {
  console.error(`\nno CREATE2 factory at ${FACTORY} on ${net}. It would have to be deployed first.`);
  process.exit(1);
}

if (!send) {
  console.log("\nDry run. Nothing was sent. Add --send to deploy.");
  process.exit(0);
}

const keyEnv = process.argv.find((a) => /^--from-env=/.test(a))?.split("=")[1];
if (!keyEnv) { console.error("\nName the funding key: --from-env=<path/to/.env>:<VAR>"); process.exit(1); }
const [file, name] = keyEnv.split(":");
const raw = new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(file!, "utf8"))?.[1]?.trim();
if (!raw || !/^0x[0-9a-fA-F]{64}$/.test(raw)) { console.error("that key is not usable"); process.exit(1); }

const deployer = privateKeyToAccount(raw as Hex);
const wallet = createWalletClient({ account: deployer, chain, transport: http(rpcUrl(net)) });
console.log(`\ndeployer     ${deployer.address}`);
console.log(`  gas        ${formatUnits(await pub.getBalance({ address: deployer.address }), 18)}`);

console.log("\ndeploying through the factory...");
const hash = await wallet.sendTransaction({
  to: FACTORY, data: concat([SALT, initCode]), account: deployer, chain,
});
const receipt = await pub.waitForTransactionReceipt({ hash });
console.log(`  ${hash}  ${receipt.status}`);

const code = await pub.getCode({ address: predicted });
if (!code || code === "0x") {
  console.error("\nthe transaction landed and there is no code at the predicted address.");
  process.exit(1);
}
console.log(`\n✓ BountyEscrow at ${predicted}, ${(code.length - 2) / 2} bytes`);
console.log(`  ${explorerUrl(net)}/address/${predicted}`);
