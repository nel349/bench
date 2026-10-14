import { expect, test, describe } from "bun:test";
import {
  CONTRACTS, arcMainnet, arcTestnet, caip2, chainOf, circleTransportPath, contractsOf,
  missingContracts, missingFrom, requireContracts, SESSION_KEY_PLUGIN, type Network,
} from "../../src/chain/chain.ts";

const NETWORKS: Network[] = ["mainnet", "testnet"];

describe("the chain ids are the ones the RPCs answer with", () => {
  test("mainnet is 5042", () => expect(arcMainnet.id).toBe(5042));
  test("testnet is 5042002", () => expect(arcTestnet.id).toBe(5042002));
  test("CAIP-2 carries the id x402 will quote", () => {
    expect(caip2("mainnet")).toBe("eip155:5042");
    expect(caip2("testnet")).toBe("eip155:5042002");
  });
});

describe("Gateway differs between networks, which is the bug this table prevents", () => {
  test("the wallets are not the same address", () => {
    expect(CONTRACTS.mainnet.gatewayWallet).not.toBe(CONTRACTS.testnet.gatewayWallet);
  });
  test("the minters are not the same address", () => {
    expect(CONTRACTS.mainnet.gatewayMinter).not.toBe(CONTRACTS.testnet.gatewayMinter);
  });
});

describe("what is genuinely shared is shared", () => {
  test("USDC is at the same address on both", () => {
    expect(CONTRACTS.mainnet.usdc).toBe(CONTRACTS.testnet.usdc);
  });
  test("EntryPoint v0.7 and Circle's owner plugin are shared", () => {
    expect(CONTRACTS.mainnet.entryPoint).toBe(CONTRACTS.testnet.entryPoint);
    expect(CONTRACTS.mainnet.ownerPlugin).toBe(CONTRACTS.testnet.ownerPlugin);
  });
  // One arbiter and one salt on both, so CREATE2 puts the escrow at one address. A different one
  // here would mean a deployment with another arbiter, whose payouts our key could not sign.
  test("our escrow is at the same address on both", () => {
    expect(CONTRACTS.mainnet.bountyEscrow).not.toBeNull();
    expect(CONTRACTS.mainnet.bountyEscrow).toBe(CONTRACTS.testnet.bountyEscrow);
  });
});

describe("what differs between the networks is kept apart", () => {
  // CREATE2 put the plugin at one address on both, as it did the escrow.
  test("the session-key plugin is on both, at the address the Mandate names", () => {
    expect(CONTRACTS.mainnet.sessionKeyPlugin).toBe(SESSION_KEY_PLUGIN);
    expect(CONTRACTS.testnet.sessionKeyPlugin).toBe(SESSION_KEY_PLUGIN);
  });
  // The standard keeps one set of addresses for testnets and another for mainnets. Looking for the
  // testnet set on mainnet finds nothing, which was once read as "not deployed".
  test("ERC-8004 is on both, at a different set of addresses on each", () => {
    const mainnet = CONTRACTS.mainnet.erc8004!;
    const testnet = CONTRACTS.testnet.erc8004!;
    expect(mainnet).not.toBeNull();
    for (const registry of ["identity", "reputation", "validation"] as const) {
      expect(mainnet[registry]).not.toBe(testnet[registry]);
    }
  });
  test("a testnet-only address never appears in the mainnet table", () => {
    const mainnet = JSON.stringify(CONTRACTS.mainnet).toLowerCase();
    for (const only of [
      CONTRACTS.testnet.gatewayWallet,
      CONTRACTS.testnet.gatewayMinter,
      ...Object.values(CONTRACTS.testnet.erc8004!),
    ]) {
      expect(mainnet).not.toContain(only.toLowerCase());
    }
  });
});

describe("every address is well formed", () => {
  for (const n of NETWORKS) {
    test(n, () => {
      const walk = (v: unknown): void => {
        if (typeof v === "string") expect(v).toMatch(/^0x[0-9a-fA-F]{40}$/);
        else if (v && typeof v === "object") Object.values(v).forEach(walk);
      };
      walk(contractsOf(n));
    });
  }
});

describe("the Circle transport path matches the network", () => {
  test("mainnet needs /arc, testnet needs /arcTestnet", () => {
    expect(circleTransportPath("mainnet")).toBe("/arc");
    expect(circleTransportPath("testnet")).toBe("/arcTestnet");
  });
});

describe("the chain carries what a payment needs", () => {
  for (const n of NETWORKS) {
    test(`${n}: USDC is the gas token, at 18 decimals`, () => {
      const c = chainOf(n);
      expect(c.nativeCurrency.symbol).toBe("USDC");
      expect(c.nativeCurrency.decimals).toBe(18);
    });
    test(`${n}: has an RPC and an explorer`, () => {
      const c = chainOf(n);
      expect(c.rpcUrls.default.http[0]).toStartWith("https://");
      expect(c.blockExplorers?.default.url).toStartWith("https://");
    });
  }
});

describe("the server refuses to start on a network that cannot serve it", () => {
  const paid = { allowance: true, onChainRatings: false } as const;
  const rated = { allowance: true, onChainRatings: true } as const;

  test("both networks can serve everything today", () => {
    for (const n of NETWORKS) {
      expect(missingContracts(n, rated)).toEqual([]);
      expect(requireContracts(n, rated)).toBe(CONTRACTS[n]);
    }
  });

  test("a network without the plugin cannot take a paid attempt", () => {
    const bare = { ...CONTRACTS.mainnet, sessionKeyPlugin: null };
    const missing = missingFrom(bare, "mainnet", paid);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("sessionKeyPlugin");
  });

  test("a network lacking both is told both at once, not one per restart", () => {
    const bare = { ...CONTRACTS.mainnet, sessionKeyPlugin: null, erc8004: null };
    const missing = missingFrom(bare, "mainnet", rated);
    expect(missing).toHaveLength(2);
    expect(missing[0]).toContain("sessionKeyPlugin");
    expect(missing[1]).toContain("ERC-8004");
  });

  test("a read-only lane needs neither", () => {
    const bare = { ...CONTRACTS.mainnet, sessionKeyPlugin: null, erc8004: null };
    expect(missingFrom(bare, "mainnet", { allowance: false, onChainRatings: false })).toEqual([]);
  });

  test("the error says where the plugin will land, not just that it is absent", () => {
    const bare = { ...CONTRACTS.mainnet, sessionKeyPlugin: null };
    expect(missingFrom(bare, "mainnet", paid)[0]).toContain(SESSION_KEY_PLUGIN);
  });
});

describe("the plugin address is deterministic across chains", () => {
  test("both networks point at the one address", () => {
    expect(CONTRACTS.testnet.sessionKeyPlugin).toBe(SESSION_KEY_PLUGIN);
    expect(CONTRACTS.mainnet.sessionKeyPlugin).toBe(SESSION_KEY_PLUGIN);
    expect(SESSION_KEY_PLUGIN).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
