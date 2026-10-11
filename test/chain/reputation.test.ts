import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { keccak256, toHex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { SLOWEST_READ_MS } from "../../src/chain/chain.ts";
import { ArcReputation } from "../../src/chain/reputation.ts";
import { usdc } from "../../src/shared/money.ts";

/**
 * Writing a run to an identity, against a node that is stood in for.
 *
 * A node that answers as a real one does, method by method, except that it is slow: it sits on the
 * question about the receipt for longer than a page's reads are given. That is a loaded node, not a
 * slow block; a healthy one says "not yet" at once and is asked again. The writer's reading of those
 * answers is the real code, over real HTTP and the real client.
 */
const REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
/** How long the node sits on one question: longer than a read is given, and well inside what a write waits. */
const RECEIPT_TAKES_MS = SLOWEST_READ_MS / 2 + 1_500;
const BLOCK = "0x10";

let node: ReturnType<typeof Bun.serve>;
const before = process.env["ARC_RPC_URL"];
let sent: string[] = [];
const unknown: string[] = [];

beforeAll(() => {
  node = Bun.serve({ port: 0, idleTimeout: 60, async fetch(req) {
    const call = await req.json() as { id: number; method: string; params: unknown[] };
    const answer = (result: unknown) => Response.json({ jsonrpc: "2.0", id: call.id, result });
    switch (call.method) {
      case "eth_chainId": return answer("0x4cef52");
      case "eth_call": return answer("0x");
      case "eth_getTransactionCount": return answer("0x0");
      case "eth_estimateGas": return answer("0x30000");
      case "eth_gasPrice": case "eth_maxPriorityFeePerGas": return answer("0x3b9aca00");
      case "eth_blockNumber": return answer(BLOCK);
      case "eth_getBlockByNumber": return answer({
        number: BLOCK, hash: `0x${"b".repeat(64)}`, parentHash: `0x${"a".repeat(64)}`, timestamp: "0x6500000",
        baseFeePerGas: "0x1", gasLimit: "0x1c9c380", gasUsed: "0x0", transactions: [],
      });
      case "eth_sendRawTransaction": {
        const hash = keccak256(call.params[0] as `0x${string}`);
        sent.push(hash);
        return answer(hash);
      }
      case "eth_getTransactionByHash": return answer(null);
      case "eth_getTransactionReceipt": {
        // Slow to answer, as a node under load is.
        await Bun.sleep(RECEIPT_TAKES_MS);
        const hash = call.params[0] as string;
        return answer({
          transactionHash: hash, transactionIndex: "0x0", blockHash: `0x${"b".repeat(64)}`, blockNumber: BLOCK,
          from: `0x${"1".repeat(40)}`, to: REGISTRY, cumulativeGasUsed: "0x30000", gasUsed: "0x30000",
          effectiveGasPrice: "0x3b9aca00", contractAddress: null, logs: [], logsBloom: `0x${"0".repeat(512)}`,
          status: "0x1", type: "0x2",
        });
      }
      // Asked first by the client, and not something this node, or most, has: it goes on without.
      case "eth_fillTransaction":
        return Response.json({ jsonrpc: "2.0", id: call.id, error: { code: -32601, message: "no such method" } });
      default:
        unknown.push(call.method);
        return Response.json({ jsonrpc: "2.0", id: call.id, error: { code: -32601, message: `no ${call.method} here` } });
    }
  } });
  process.env["ARC_RPC_URL"] = `http://127.0.0.1:${node.port}`;
});
afterAll(() => {
  void node.stop(true);
  if (before === undefined) delete process.env["ARC_RPC_URL"]; else process.env["ARC_RPC_URL"] = before;
});

describe("writing a run to an identity", () => {
  /**
   * The writer's own questions were given the short patience a page's reads have, and asking for a
   * receipt is one of them. Against a node this slow it gave up on a record it had already sent and
   * reported it unwritten, which invites sending it again.
   */
  test("a node slow to answer about the receipt is waited for, and the record is reported written", async () => {
    sent = [];
    const writer = new ArcReputation("testnet", generatePrivateKey(), REGISTRY);
    const tx = await writer.write({
      agentId: 42n, problem: "toll", cost: usdc("0.02"), endpoint: "https://bench.test",
      uri: "https://bench.test/attempts/a1", hash: keccak256(toHex("a1")),
    });
    expect(unknown).toEqual([]);
    expect(sent).toEqual([tx]);
  }, 60_000);
});
