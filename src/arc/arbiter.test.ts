import { expect, test, describe, beforeEach } from "bun:test";
import { arbiterKey, type Arbiter, type Award } from "./arbiter.ts";
import { handle, type Deps } from "../http.ts";
import { Attempts } from "../attempt.ts";
import { Bounties } from "../bounties.ts";
import { SqliteBounties } from "../bounty-store.ts";
import { InMemoryAllowance } from "../payments.ts";
import { usdc } from "../money.ts";
import "../problems/blackbox-problem.ts";

const SOLVER = "0xAbC0000000000000000000000000000000000001";
const SECRET = 424242;

describe("reading the key", () => {
  test("a proper key is accepted", () => {
    const k = `0x${"a".repeat(64)}`;
    expect(arbiterKey(k)).toBe(k as `0x${string}`);
  });
  test("absent is not an error: an arbiter is optional", () => {
    expect(arbiterKey(undefined)).toBe(null);
    expect(arbiterKey("")).toBe(null);
  });
  test("a malformed key throws at startup, not at the moment someone wins", () => {
    for (const bad of ["nope", "0x123", `0x${"a".repeat(63)}`, `${"a".repeat(64)}`]) {
      expect(() => arbiterKey(bad)).toThrow("32-byte hex");
    }
  });
  test("the error does not echo the value it was given", () => {
    try { arbiterKey("0xSECRETISHLOOKINGVALUE"); } catch (e) {
      expect((e as Error).message).not.toContain("SECRETISHLOOKINGVALUE");
    }
  });
});

/** An arbiter that does what it is told to do, so the failure paths are reachable. */
const scripted = (result: Award, calls: { escrowId: string; solver: string }[] = []): Arbiter => ({
  address: "0x000000000000000000000000000000000000bEEF",
  async award(escrowId, solver) { calls.push({ escrowId, solver }); return result; },
});

describe("winning and being paid are different things", () => {
  let bounties: Bounties;
  let deps: Deps;
  let calls: { escrowId: string; solver: string }[];

  const setup = (arbiter?: Arbiter) => {
    const money = new InMemoryAllowance();
    money.grant("agent:pro", usdc("5"));
    bounties = new Bounties();
    deps = {
      attempts: new Attempts(money), payments: money, net: "testnet", bounties,
      ...(arbiter ? { arbiter } : {}),
    };
  };

  const postBounty = (escrowId: string | null = "7") => {
    const p = bounties.post({
      poster: "agent:acme", title: "t", statement: "s", checker: { kind: "equals", value: SECRET },
      amount: "500.00", deadline: Date.now() + 7 * 24 * 3600 * 1000,
      ...(escrowId ? { escrowId } : {}),
    });
    if (!p.ok) throw new Error(p.problem);
    return p.bounty;
  };

  const solve = (id: string, answer: unknown = SECRET) =>
    handle(new Request(`http://x/bounties/${id}/solve`, {
      method: "POST", headers: { "x-agent": "agent:pro", "content-type": "application/json" },
      body: JSON.stringify({ answer }),
    }), deps);

  const retry = (id: string) =>
    handle(new Request(`http://x/bounties/${id}/award`, {
      method: "POST", headers: { "x-agent": "agent:pro" },
    }), deps);

  beforeEach(() => { calls = []; });

  test("a win pays out when the arbiter works", async () => {
    setup(scripted({ ok: true, tx: "0xdead" }, calls));
    const b = postBounty();
    const body = await (await solve(b.id)).json() as { solved: boolean; bounty: { awardTx: string } };
    expect(body.solved).toBe(true);
    expect(body.bounty.awardTx).toBe("0xdead");
    expect(calls).toEqual([{ escrowId: "7", solver: "agent:pro" }]);
  });

  /**
   * The point of splitting them. A prize must not depend on the gas market at the moment somebody
   * answered.
   */
  test("a failed payout does NOT undo the win", async () => {
    setup(scripted({ ok: false, because: "underpriced" }, calls));
    const b = postBounty();
    const body = await (await solve(b.id)).json() as { solved: boolean; bounty: { solvedBy: string; awardTx: string | null; awaitingPayout: boolean } };
    expect(body.solved).toBe(true);
    expect(body.bounty.solvedBy).toBe("agent:pro");
    expect(body.bounty.awardTx).toBe(null);
    expect(body.bounty.awaitingPayout).toBe(true);
  });

  test("and it can be retried, and then it is paid", async () => {
    setup(scripted({ ok: false, because: "underpriced" }));
    const b = postBounty();
    await solve(b.id);

    deps = { ...deps, arbiter: scripted({ ok: true, tx: "0xbeef" }, calls) };
    const out = await (await retry(b.id)).json() as { paid: boolean; tx: string };
    expect(out.paid).toBe(true);
    expect(out.tx).toBe("0xbeef");
    expect(bounties.get(b.id)!.awardTx).toBe("0xbeef");
  });

  test("retrying a paid bounty sends nothing: it is idempotent", async () => {
    setup(scripted({ ok: true, tx: "0xdead" }, calls));
    const b = postBounty();
    await solve(b.id);
    expect(calls).toHaveLength(1);

    const out = await (await retry(b.id)).json() as { alreadyPaid: boolean; tx: string };
    expect(out.alreadyPaid).toBe(true);
    expect(out.tx).toBe("0xdead");
    expect(calls).toHaveLength(1); // no second transaction
  });

  test("the first transaction to settle it is the one kept", async () => {
    setup(scripted({ ok: true, tx: "0xfirst" }));
    const b = postBounty();
    await solve(b.id);
    bounties.paid(b.id, "0xsecond");
    expect(bounties.get(b.id)!.awardTx).toBe("0xfirst");
  });

  test("a wrong answer never triggers a payout", async () => {
    setup(scripted({ ok: true, tx: "0xdead" }, calls));
    const b = postBounty();
    await solve(b.id, 0);
    expect(calls).toHaveLength(0);
  });

  test("retrying a bounty nobody has won is a 409", async () => {
    setup(scripted({ ok: true, tx: "0xdead" }));
    expect((await retry(postBounty().id)).status).toBe(409);
  });

  test("a bounty with no escrow behind it says so rather than pretending", async () => {
    setup(scripted({ ok: true, tx: "0xdead" }, calls));
    const b = postBounty(null);
    const body = await (await solve(b.id)).json() as { solved: boolean; bounty: { awaitingPayout: boolean } };
    expect(body.solved).toBe(true);
    expect(body.bounty.awaitingPayout).toBe(false); // nothing to wait for
    expect(calls).toHaveLength(0);
    expect((await retry(b.id)).status).toBe(409);
  });

  test("with no arbiter at all, wins are still recorded and shown as unpaid", async () => {
    setup();
    const b = postBounty();
    const body = await (await solve(b.id)).json() as { solved: boolean; bounty: { awaitingPayout: boolean } };
    expect(body.solved).toBe(true);
    expect(body.bounty.awaitingPayout).toBe(true);
    expect((await retry(b.id)).status).toBe(503);
  });

  test("an unpaid win survives a restart and is still sweepable", () => {
    const path = `${import.meta.dir}/../../.tmp-arbiter-${Date.now()}.sqlite`;
    const first = new Bounties(new SqliteBounties(path));
    const p = first.post({
      poster: "agent:acme", title: "t", statement: "s", checker: { kind: "equals", value: SECRET },
      amount: "1.00", deadline: Date.now() + 7 * 24 * 3600 * 1000, escrowId: "9",
    });
    if (!p.ok) throw new Error(p.problem);
    first.solve(p.bounty.id, SECRET, SOLVER, []);

    const after = new Bounties(new SqliteBounties(path));
    expect(after.awaitingPayout().map((b) => b.id)).toEqual([p.bounty.id]);
    require("node:fs").rmSync(path, { force: true });
    require("node:fs").rmSync(`${path}-wal`, { force: true });
    require("node:fs").rmSync(`${path}-shm`, { force: true });
  });
});
