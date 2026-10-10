import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeFunctionResult } from "viem";
import { ArcRegistry, REGISTRY_ABI } from "../../src/chain/identity.ts";

/**
 * A node, stood in for: it answers each `eth_call` the way a real one would in the case under test.
 * The registry's reading of those answers is the real code, over real HTTP and the real client.
 */
type Answer = { readonly result: string } | { readonly error: object } | { readonly status: number };
let answer: Answer = { result: "0x" };
let node: ReturnType<typeof Bun.serve>;
const before = process.env["ARC_RPC_URL"];

beforeAll(() => {
  node = Bun.serve({ port: 0, async fetch(req) {
    const call = await req.json() as { id: number };
    if ("status" in answer) return new Response("unavailable", { status: answer.status });
    return Response.json({ jsonrpc: "2.0", id: call.id, ...answer });
  } });
  process.env["ARC_RPC_URL"] = `http://127.0.0.1:${node.port}`;
});
afterAll(() => {
  void node.stop(true);
  if (before === undefined) delete process.env["ARC_RPC_URL"]; else process.env["ARC_RPC_URL"] = before;
});

const HOLDER = "0x9fa928ACfE2eEcEad9698ebBad835E7129688b28";
const registry = () => new ArcRegistry("testnet");
/** `ERC721NonexistentToken(uint256)`, as Arc's registry reverts for an id nobody holds. */
const NO_SUCH_TOKEN = `0x7e273289${encodeAbiParameters([{ type: "uint256" }], [42n]).slice(2)}`;

describe("who holds an identity, and when that is not known", () => {
  test("the holder, when the registry names one", async () => {
    answer = { result: encodeFunctionResult({ abi: REGISTRY_ABI, functionName: "ownerOf", result: HOLDER }) };
    expect(await registry().holderOf(42n)).toBe(HOLDER);
  });

  test("nobody, when the contract itself refuses the id and says why", async () => {
    answer = { error: { code: 3, message: "execution reverted", data: NO_SUCH_TOKEN } };
    expect(await registry().holderOf(42n)).toBeNull();
  });

  /**
   * The client library calls a node's internal error a revert too. Read as "nobody", it was then
   * kept for ten minutes, and an owner's former agent was gone from their page for as long.
   */
  test("a node that is failing is a failure, not an answer", async () => {
    answer = { error: { code: -32603, message: "Internal error" } };
    await expect(registry().holderOf(42n)).rejects.toThrow();
    answer = { status: 503 };
    await expect(registry().holderOf(42n)).rejects.toThrow();
  }, 30_000);

  test("the check that fails closed still says nobody for either", async () => {
    answer = { error: { code: -32603, message: "Internal error" } };
    expect(await registry().ownerOf(42n)).toBeNull();
    answer = { error: { code: 3, message: "execution reverted", data: NO_SUCH_TOKEN } };
    expect(await registry().ownerOf(42n)).toBeNull();
  }, 30_000);
});
