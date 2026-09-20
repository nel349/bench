/**
 * Puts USDC into an agent's Gateway deposit, which is what x402 actually spends.
 *
 * Holding USDC is not enough: the facilitator settles against a Gateway balance, so an agent with
 * a full wallet and no deposit is refused with `insufficient_balance` — which is exactly where
 * `pay:once` stops today.
 *
 * Two transactions, not one. `depositFor` pulls with `transferFrom`, so the allowance has to land
 * first; batching them is what the mandate's plugin does for a smart account, and an EOA cannot.
 *
 * **Dry by default.** It prints what it would do and stops. `--send` is the word that spends money.
 *
 * On Arc the native balance and the ERC-20 view are the same money, so every dollar deposited is a
 * dollar not available for gas. The funder's remaining balance is printed for that reason.
 */
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits, getAddress } from "viem";
import { chainOf, contractsOf, rpcUrl } from "../src/arc/chain.ts";
import { usdc as parseUsdc, format } from "../src/money.ts";

const net = "testnet" as const;
const c = contractsOf(net);
const send = process.argv.includes("--send");

const amountArg = process.argv.find((a) => /^--amount=/.test(a))?.split("=")[1] ?? "0.10";
const amount = parseUsdc(amountArg);

const beneficiary = getAddress(
  process.argv.find((a) => /^--to=/.test(a))?.split("=")[1] ?? "0x3535816e967Ad2B6271dfadf9138fb07eAB161Ce",
);

/** The funder's key, named rather than defaulted: spending the wrong key is not recoverable. */
const keyEnv = process.argv.find((a) => /^--from-env=/.test(a))?.split("=")[1];
const keyFile = process.argv.find((a) => /^--from-file=/.test(a))?.split("=")[1];
let raw: string | undefined;
if (keyEnv) {
  const [file, name] = keyEnv.split(":");
  raw = new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(file!, "utf8"))?.[1]?.trim();
} else if (keyFile) {
  raw = readFileSync(keyFile, "utf8").trim();
}
if (!raw || !/^0x[0-9a-fA-F]{64}$/.test(raw)) {
  console.error("Name the funding key: --from-env=<path/to/.env>:<VAR>  or  --from-file=<path>");
  process.exit(1);
}
const funder = privateKeyToAccount(raw as `0x${string}`);

const chain = chainOf(net);
const transport = http(rpcUrl(net));
const pub = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account: funder, chain, transport });

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
]);
const gateway = parseAbi([
  "function depositFor(address token, address depositor, uint256 value)",
  "function availableBalance(address token, address depositor) view returns (uint256)",
]);

const held = await pub.readContract({ address: c.usdc as `0x${string}`, abi: erc20, functionName: "balanceOf", args: [funder.address] }) as bigint;
const before = await pub.readContract({ address: c.gatewayWallet as `0x${string}`, abi: gateway, functionName: "availableBalance", args: [c.usdc as `0x${string}`, beneficiary] }).catch(() => 0n) as bigint;

console.log(`funder       ${funder.address}`);
console.log(`  holds      ${formatUnits(held, 6)} USDC  (which is also its gas)`);
console.log(`beneficiary  ${beneficiary}`);
console.log(`  deposit    ${formatUnits(before, 6)} USDC`);
console.log(`\ndepositing   ${format(amount)} USDC`);

if (held < amount) {
  console.error(`\nthe funder holds less than that. Nothing sent.`);
  process.exit(1);
}
const leftForGas = held - amount;
console.log(`funder left  ${formatUnits(leftForGas, 6)} USDC for gas afterwards`);

if (!send) {
  console.log("\nDry run. Nothing was sent. Add --send to spend.");
  process.exit(0);
}

console.log("\n1. approving the Gateway to pull it");
const approve = await wallet.writeContract({
  address: c.usdc as `0x${string}`, abi: erc20, functionName: "approve",
  args: [c.gatewayWallet as `0x${string}`, amount], chain, account: funder,
});
await pub.waitForTransactionReceipt({ hash: approve });
console.log(`   ${approve}`);

console.log("2. depositing it to the beneficiary");
const deposit = await wallet.writeContract({
  address: c.gatewayWallet as `0x${string}`, abi: gateway, functionName: "depositFor",
  args: [c.usdc as `0x${string}`, beneficiary, amount], chain, account: funder,
});
const receipt = await pub.waitForTransactionReceipt({ hash: deposit });
console.log(`   ${deposit}  ${receipt.status}`);

const after = await pub.readContract({ address: c.gatewayWallet as `0x${string}`, abi: gateway, functionName: "availableBalance", args: [c.usdc as `0x${string}`, beneficiary] }) as bigint;
console.log(`\ndeposit now  ${formatUnits(after, 6)} USDC  (was ${formatUnits(before, 6)})`);
