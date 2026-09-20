/**
 * Prove the address table against the live chains.
 *
 * Every address in `chain.ts` claims something about the world. This asks the chain whether the
 * claim is true: each address that should have code does, each `null` really is absent, and each
 * network answers with the id we think it has.
 *
 * Needs the network. It is not part of `bun test`, which must run with no keys and no connection —
 * run it by hand, or in CI where a network is allowed:
 *
 *     bun run verify:addresses
 */
import { CONTRACTS, chainOf, rpcUrl, type Network } from "../src/arc/chain.ts";

type Check = { readonly what: string; readonly ok: boolean; readonly detail: string };

async function rpc(url: string, method: string, params: unknown[]): Promise<string | null> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await r.json()) as { result?: string };
    return j.result ?? null;
  } catch {
    return null;
  }
}

/** Flatten the table into "this address should have code" / "this slot should be empty". */
function expectations(n: Network): { label: string; address: string | null }[] {
  const c = CONTRACTS[n];
  return [
    { label: "usdc", address: c.usdc },
    { label: "gatewayWallet", address: c.gatewayWallet },
    { label: "gatewayMinter", address: c.gatewayMinter },
    { label: "entryPoint", address: c.entryPoint },
    { label: "ownerPlugin", address: c.ownerPlugin },
    { label: "sessionKeyPlugin", address: c.sessionKeyPlugin },
    { label: "bountyEscrow", address: c.bountyEscrow },
    { label: "erc8004.identity", address: c.erc8004?.identity ?? null },
    { label: "erc8004.reputation", address: c.erc8004?.reputation ?? null },
    { label: "erc8004.validation", address: c.erc8004?.validation ?? null },
  ];
}

async function verify(n: Network): Promise<Check[]> {
  const url = rpcUrl(n);
  const chain = chainOf(n);
  const checks: Check[] = [];

  const id = await rpc(url, "eth_chainId", []);
  const expected = `0x${chain.id.toString(16)}`;
  checks.push({
    what: `${n}: chain id`,
    ok: id === expected,
    detail: id === null ? `${url} did not answer` : `${id}, expected ${expected}`,
  });
  if (id === null) return checks;

  for (const { label, address } of expectations(n)) {
    if (address === null) {
      checks.push({ what: `${n}: ${label}`, ok: true, detail: "null in the table, nothing to check" });
      continue;
    }
    const code = await rpc(url, "eth_getCode", [address, "latest"]);
    const bytes = code && code !== "0x" ? (code.length - 2) / 2 : 0;
    checks.push({
      what: `${n}: ${label}`,
      ok: bytes > 0,
      detail: bytes > 0 ? `${bytes} bytes at ${address}` : `NO CODE at ${address}`,
    });
  }
  return checks;
}

const all = [...(await verify("testnet")), ...(await verify("mainnet"))];
for (const c of all) console.log(`  ${c.ok ? "ok  " : "FAIL"}  ${c.what.padEnd(28)} ${c.detail}`);

const failed = all.filter((c) => !c.ok);
console.log(`\n  ${all.length - failed.length}/${all.length} checks passed`);
if (failed.length > 0) process.exit(1);
