import { expect, test, describe } from "bun:test";
import {
  CONTRACTS, arcMainnet, arcTestnet, caip2, chainOf, circleTransportPath, contractsOf,
  missingContracts, requireContracts, type Network,
} from "./chain.ts";

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
});

describe("what is absent from mainnet is null, not a testnet address", () => {
  test("no session-key plugin on mainnet until we deploy it", () => {
    expect(CONTRACTS.mainnet.sessionKeyPlugin).toBeNull();
    expect(CONTRACTS.testnet.sessionKeyPlugin).not.toBeNull();
  });
  test("no ERC-8004 on mainnet", () => {
    expect(CONTRACTS.mainnet.erc8004).toBeNull();
    expect(CONTRACTS.testnet.erc8004).not.toBeNull();
  });
  test("a testnet-only address never appears in the mainnet table", () => {
    const mainnet = JSON.stringify(CONTRACTS.mainnet).toLowerCase();
    for (const only of [
      CONTRACTS.testnet.gatewayWallet,
      CONTRACTS.testnet.gatewayMinter,
      CONTRACTS.testnet.sessionKeyPlugin!,
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

  test("testnet can serve everything today", () => {
    expect(missingContracts("testnet", rated)).toEqual([]);
    expect(requireContracts("testnet", rated)).toBe(CONTRACTS.testnet);
  });

  test("mainnet cannot take a paid attempt until the plugin is deployed", () => {
    const missing = missingContracts("mainnet", paid);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("sessionKeyPlugin");
  });

  test("mainnet names both problems at once, not one per restart", () => {
    expect(missingContracts("mainnet", rated)).toHaveLength(2);
  });

  test("mainnet is fine for a read-only lane", () => {
    expect(missingContracts("mainnet", { allowance: false, onChainRatings: false })).toEqual([]);
  });

  test("the error says what is missing and what to do", () => {
    expect(() => requireContracts("mainnet", rated)).toThrow(/deploy it and fill in/);
  });
});
