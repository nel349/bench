/**
 * Asks the chain whether the ABIs in this repo match the contracts they claim to describe.
 *
 * A wrong ABI compiles, typechecks and passes every test that stubs the chain. It fails once, in
 * production, against real money — and the error is a revert with no reason, which tells you
 * nothing. So the function selectors are looked for in the deployed bytecode: present or not is a
 * fact the chain can answer, and no key or funded account is needed to ask it.
 *
 * Not part of `gate`, for the same reason `verify:addresses` is not: it needs a network.
 */
import { createPublicClient, http, toFunctionSelector, type Abi, type Address } from "viem";
import { chainOf, contractsOf, rpcUrl, type Network } from "../src/arc/chain.ts";
import { SESSION_KEY_ABI } from "../src/arc/allowance.ts";
import { REGISTRY_ABI } from "../src/arc/identity.ts";

interface Target { readonly what: string; readonly at: Address | null | undefined; readonly abi: Abi }

function targets(net: Network): Target[] {
  const c = contractsOf(net);
  return [
    { what: "session-key plugin", at: c.sessionKeyPlugin as Address | null, abi: SESSION_KEY_ABI as unknown as Abi },
    { what: "ERC-8004 identity", at: c.erc8004?.identity as Address | undefined, abi: REGISTRY_ABI as unknown as Abi },
  ];
}

/** EIP-1967: where a proxy keeps the address it delegates to. */
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

/**
 * The bytecode that actually answers calls to this address.
 *
 * A proxy is ~130 bytes of delegatecall and holds none of the selectors it serves, so checking the
 * address itself reports every function missing. The ERC-8004 registries are proxies, and the first
 * version of this script called them all wrong for exactly that reason — while being right about
 * the session-key plugin, which is not one. Half a right answer is the most misleading kind.
 */
async function codeBehind(
  client: ReturnType<typeof createPublicClient>, at: Address,
): Promise<string | undefined> {
  const code = await client.getCode({ address: at });
  if (!code || code === "0x") return code;

  const slot = await client.getStorageAt({ address: at, slot: IMPL_SLOT });
  if (!slot || /^0x0*$/.test(slot)) return code;

  const impl = `0x${slot.slice(-40)}` as Address;
  const behind = await client.getCode({ address: impl });
  if (behind && behind !== "0x") {
    console.log(`    (proxy → ${impl})`);
    return behind;
  }
  return code;
}

let failures = 0;
let checked = 0;

for (const net of ["testnet", "mainnet"] as const) {
  console.log(`\n${net}`);
  const client = createPublicClient({ chain: chainOf(net), transport: http(rpcUrl(net)) });

  for (const { what, at, abi } of targets(net)) {
    if (!at) { console.log(`  · ${what}: not deployed here, nothing to check`); continue; }

    let code: string | undefined;
    try {
      code = await codeBehind(client, at);
    } catch (e) {
      console.log(`  ? ${what} @ ${at}: could not reach the chain (${e instanceof Error ? e.message.slice(0, 60) : "?"})`);
      continue;
    }
    if (!code || code === "0x") {
      console.log(`  ✗ ${what} @ ${at}: NO CODE`);
      failures++;
      continue;
    }

    for (const entry of abi) {
      if (entry.type !== "function") continue;
      const selector = toFunctionSelector(entry).slice(2);
      const present = code.includes(selector);
      checked++;
      if (!present) failures++;
      console.log(`  ${present ? "✓" : "✗"} ${what}.${entry.name}  0x${selector}`);
    }
  }
}

console.log(`\n${checked - failures}/${checked} selectors found in deployed bytecode`);
if (failures > 0) {
  console.error("An ABI does not match what is deployed. That is a revert with no reason, later.");
  process.exit(1);
}
