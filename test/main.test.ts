import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeFunctionResult, toFunctionSelector } from "viem";
import { SESSION_KEY_ABI } from "../src/chain/allowance.ts";
import { SLOWEST_READ_MS } from "../src/chain/chain.ts";
import { Attempts } from "../src/gym/attempt.ts";
import type { Charge } from "../src/gym/payments.ts";
import { CHAIN_STEPS, IDLE_S } from "../src/http/limits.ts";
import type { OwnerWire } from "../src/shared/wire.ts";
import { SqliteStore } from "../src/store/runs.ts";
import "../src/problems/blackbox.ts";

/**
 * The server as it is started, with everything it is given wired as `main.ts` wires it.
 *
 * Every other test hands the router its parts. This one checks the parts `main.ts` chooses, by
 * starting it against a node that is stood in for and a database with one run in it, and asking it
 * questions whose answers depend on those choices.
 */
const WALLET = "0x9fa928ACfE2eEcEad9698ebBad835E7129688b28";
/** The agent that paid for the run in the record, under identity 42. The wallet no longer grants to it. */
const FORMER = "0x3535816e967ad2b6271dfadf9138fb07eab161ce";
/** A second wallet, which grants to one agent now. The first grants to none, so its page turns on the registry alone. */
const GRANTING = "0x00000000000000000000000000000000000000bb";
const CURRENT: `0x${string}` = "0x00000000000000000000000000000000000000aa";
const SESSION_KEYS_OF = toFunctionSelector("sessionKeysOf(address)");

/** How the stood-in node treats every call but "which agents does this wallet grant to". */
let node: ReturnType<typeof Bun.serve>;
let others: "fail" | "say nothing" = "fail";
/**
 * How long the node takes over "which agents" while it is saying nothing to everything else. Under
 * a reader's patience, so the answer is used; and with one more step waited out in full after it,
 * the request is past the ten seconds a connection used to be kept, whatever the server remembers
 * from an earlier test.
 */
const SLOW_BUT_ANSWERS_MS = 3_000;
/** Longer than any reader waits, and not for ever, so the stand-in can be stopped afterwards. */
const SAYS_NOTHING_FOR_MS = SLOWEST_READ_MS + 4_000;

let gym: ReturnType<typeof Bun.spawn> | undefined;
let folder = "";
let at = "";
/** How long the server is given to start answering. It takes about a second. */
const STARTS_WITHIN_MS = 15_000;

beforeAll(async () => {
  // One run, paid for by an agent with a proven identity, kept where the server will find it.
  folder = mkdtempSync(join(tmpdir(), "bench-main-"));
  const db = join(folder, "runs.sqlite");
  const attempts = new Attempts(
    { async charge(_agent, amount): Promise<Charge> { return { ok: true, paid: amount, spentSoFar: 0n, payer: FORMER }; }, spentBy: () => 0n },
    new SqliteStore(db),
    async () => true,
  );
  const run = attempts.start("anonymous", "blackbox", "seed", null, 42n)!;
  await attempts.ask(run.id, { side: "up", index: 0 });
  expect(attempts.get(run.id)!.identity).toBe("42");

  node = Bun.serve({ port: 0, idleTimeout: 60, async fetch(req) {
    const call = await req.json() as { id: number; params?: [{ data?: string }] };
    const data = call.params?.[0]?.data ?? "";
    if (data.startsWith(SESSION_KEYS_OF)) {
      if (others === "say nothing") await Bun.sleep(SLOW_BUT_ANSWERS_MS);
      // The wallet asked about is the call's one argument, at the end of its data.
      const granted: `0x${string}`[] = data.toLowerCase().endsWith(GRANTING.slice(2)) ? [CURRENT] : [];
      return Response.json({ jsonrpc: "2.0", id: call.id, result: encodeFunctionResult({ abi: SESSION_KEY_ABI, functionName: "sessionKeysOf", result: granted }) });
    }
    if (others === "say nothing") { await Bun.sleep(SAYS_NOTHING_FOR_MS); return new Response("late", { status: 504 }); }
    return Response.json({ jsonrpc: "2.0", id: call.id, error: { code: -32603, message: "Internal error" } });
  } });

  // The same Bun that is running this, told not to read an `.env` from the repository: left to
  // itself it loads one, and a developer's own keys and addresses would be wired into the server
  // under test. The environment below is then all it has. It picks its own port, and says which.
  const child = Bun.spawn([process.execPath, "--no-env-file", "run", "src/main.ts"], {
    cwd: join(import.meta.dir, ".."),
    env: {
      PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "",
      ARC_NETWORK: "testnet", ARC_RPC_URL: `http://127.0.0.1:${node.port}`, BENCH_DB: db, PORT: "0",
    },
    stdout: "pipe", stderr: "pipe",
  });
  gym = child;
  // Both read as they are written: one says where it is listening, the other why it is not, and a
  // pipe nobody reads fills and stops the server.
  const said = { out: "", err: "" };
  const follow = async (stream: ReadableStream<Uint8Array>, into: "out" | "err") => {
    const text = new TextDecoder();
    for await (const part of stream) said[into] += text.decode(part, { stream: true });
  };
  void follow(child.stdout as ReadableStream<Uint8Array>, "out");
  void follow(child.stderr as ReadableStream<Uint8Array>, "err");
  let gone = false;
  void child.exited.then(() => { gone = true; });

  const deadline = Date.now() + STARTS_WITHIN_MS;
  while (Date.now() < deadline && !gone) {
    const port = /listening on :(\d+)/.exec(said.out)?.[1];
    if (port !== undefined && port !== "0") {
      at = `http://127.0.0.1:${port}`;
      try { if ((await fetch(`${at}/problems`)).ok) return; } catch { /* not answering yet */ }
    }
    await Bun.sleep(50);
  }
  throw new Error(`the server ${gone ? "stopped before it answered" : "did not answer in time"}: ${said.err || "it said nothing"}`);
}, 30_000);

afterAll(async () => {
  gym?.kill();
  await gym?.exited;
  // Not waited for: a call it is still sitting on would hold this up for as long as it sits.
  void node?.stop(true);
  if (folder !== "") rmSync(folder, { recursive: true, force: true });
}, 20_000);

/**
 * One request, made once, over a connection of its own.
 *
 * `fetch` is too forgiving to test with here: when a server drops a connection it quietly asks
 * again, and the second asking joins the reading the first one started, so a request the server
 * hung up on still comes back answered. This sends the request and reports what came back on that
 * one connection, which is what a caller with no such manners would see.
 */
function askOnce(url: string): Promise<{ readonly status: number; readonly body: string }> {
  const { hostname, port, pathname } = new URL(url);
  return new Promise((resolve, reject) => {
    let got = "";
    let answered = false;
    const text = new TextDecoder();
    /** The answer, once all of it is here: the head, and as much body as the head says there is. */
    const whole = (): { readonly status: number; readonly body: string } | null => {
      const head = got.indexOf("\r\n\r\n");
      const status = Number(/^HTTP\/1\.1 (\d+)/.exec(got)?.[1]);
      const length = Number(/\r\ncontent-length: (\d+)/i.exec(got.slice(0, Math.max(head, 0)))?.[1]);
      if (head === -1 || !Number.isFinite(status) || !Number.isFinite(length)) return null;
      const body = got.slice(head + 4);
      return new TextEncoder().encode(body).length >= length ? { status, body } : null;
    };
    void Bun.connect({
      hostname, port: Number(port),
      socket: {
        open(socket) { socket.write(`GET ${pathname} HTTP/1.1\r\nHost: ${hostname}\r\n\r\n`); },
        data(socket, part) {
          got += text.decode(part, { stream: true });
          const answer = whole();
          if (answer === null) return;
          answered = true;
          resolve(answer);
          socket.end();
        },
        close() { if (!answered) reject(new Error("the connection was closed with no answer")); },
        error(_socket, cause) { reject(cause); },
      },
    }).catch(reject);
  });
}

describe("the server as main.ts starts it", () => {
  /**
   * A node that takes each connection and says nothing. The server's connections used to close
   * after ten idle seconds, and the readers waited forty, so the caller got a dropped socket where
   * it was owed an answer. Here the page's first step is slow and at least one more is waited out
   * in full, which is past those ten seconds: the answer arriving at all is the server keeping the
   * connection open, and its saying it is not whole is the readers giving up in time.
   *
   * Whether the registry's step is waited out too depends on whether the server still remembers it
   * failing from another test, so the time allowed covers both.
   */
  test("a node that says nothing still gets the caller an answer, and the answer says what is missing", async () => {
    others = "say nothing";
    const started = Date.now();
    const response = await askOnce(`${at}/owner/${GRANTING}`).finally(() => { others = "fail"; });
    const took = Date.now() - started;
    expect(response.status).toBe(200);
    const page = JSON.parse(response.body) as OwnerWire;
    expect(page.partial).toBe(true);
    expect(page.agents.map((a) => a.address.toLowerCase())).toEqual([CURRENT]);
    expect(page.agents[0]!.allowance).toBeNull();
    // Longer than a connection used to be kept, and no longer than every step waited out.
    expect(took).toBeGreaterThan(10_000);
    expect(took).toBeLessThan(SLOW_BUT_ANSWERS_MS + 2 * SLOWEST_READ_MS + 3_000);
  }, 60_000);

  test("the slowest request there is fits inside how long a connection is kept", () => {
    expect(SLOWEST_READ_MS * CHAIN_STEPS).toBeLessThan(IDLE_S * 1000);
  });

  /**
   * The registry has two readings: one that says "nobody" when it cannot be read, for deciding
   * whether to trust a claim, and one that says it could not be read. The owner's page needs the
   * second. Wired to the first, a registry that was down took an owner's former agent off their page
   * and the page said nothing was missing.
   *
   * This wallet grants to no agent now, so nothing else on its page reads the chain: the page is
   * not whole only because of who holds the identity in the record.
   */
  test("an owner's page says it is not whole when the registry cannot be read", async () => {
    const response = await fetch(`${at}/owner/${WALLET}`);
    expect(response.status).toBe(200);
    const page = await response.json() as OwnerWire;
    expect(page.agents).toEqual([]);
    expect(page.partial).toBe(true);
  }, 30_000);
});
