import { expect, test, describe, beforeEach } from "bun:test";
import { handle, type Deps } from "../http.ts";
import { Attempts } from "../attempt.ts";
import { Bounties } from "../bounties.ts";
import { InMemoryAllowance } from "../payments.ts";
import { usdc, format } from "../money.ts";
import type { Backed, Backing, EscrowReader } from "./escrow.ts";
import "../problems/blackbox-problem.ts";

const POSTER = "0x00000000000000000000000000000000000AcmE" as `0x${string}`;
const WEEK = 7 * 24 * 3600 * 1000;

/** The chain, scripted. Nothing here reaches one. */
const chainSaying = (escrows: Record<string, Partial<Backing> | "missing" | "down">): EscrowReader => ({
  async read(id): Promise<Backed> {
    const e = escrows[id];
    if (e === undefined || e === "missing") return { ok: false, because: `there is no escrow ${id}` };
    if (e === "down") return { ok: false, unavailable: true, because: "the chain could not be reached" };
    return { ok: true, backing: {
      escrowId: id, poster: POSTER, amount: usdc("500"),
      deadline: Date.now() + WEEK, settled: false, ...e } };
  },
});

let bounties: Bounties;
let deps: Deps;
const setup = (escrow?: EscrowReader) => {
  const money = new InMemoryAllowance();
  for (const who of ["agent:liar", POSTER, POSTER.toLowerCase(),
                     "0x00000000000000000000000000000000000000ff"]) {
    money.grant(who, usdc("50"));
  }
  bounties = new Bounties();
  deps = { attempts: new Attempts(money), payments: money, net: "testnet", bounties,
           ...(escrow ? { escrow } : {}) };
};
beforeEach(() => setup(chainSaying({ "1": {} })));

const post = (body: Record<string, unknown>) =>
  handle(new Request("http://x/bounties", {
    method: "POST", headers: { "x-agent": "agent:liar", "content-type": "application/json" },
    body: JSON.stringify({ title: "t", statement: "s", checker: { kind: "equals", value: 1 },
      amount: "1000000.00", deadline: Date.now() + WEEK, ...body }),
  }), deps);

/**
 * The defect this exists for: a listing named its escrow with a string we stored unquestioned, so a
 * bounty of any size could be posted against money that was not there and would show as open.
 */
describe("a bounty must be backed by the money it claims", () => {
  test("an escrow that does not exist is refused", async () => {
    const r = await post({ escrowId: "99999" });
    expect(r.status).toBe(400);
    expect((await r.json() as { error: string }).error).toContain("no escrow 99999");
    expect(bounties.all()).toHaveLength(0);
  });

  test("the million-dollar bounty backed by nothing no longer posts", async () => {
    expect((await post({ escrowId: "99999" })).status).toBe(400);
    expect((await post({ escrowId: "not-a-number" })).status).toBe(400);
    expect(bounties.all()).toHaveLength(0);
  });

  test("an escrow already paid out or reclaimed is refused", async () => {
    setup(chainSaying({ "1": { settled: true } }));
    expect((await post({ escrowId: "1" })).status).toBe(400);
  });

  test("an escrow holding nothing is refused", async () => {
    setup(chainSaying({ "1": { amount: 0n } }));
    expect((await post({ escrowId: "1" })).status).toBe(400);
  });

  test("an escrow that expires too soon to attempt is refused", async () => {
    setup(chainSaying({ "1": { deadline: Date.now() + 60_000 } }));
    const r = await post({ escrowId: "1" });
    expect(r.status).toBe(400);
    expect((await r.json() as { error: string }).error).toContain("expires too soon");
  });

  test("an unreachable chain is our failure, not the poster's: 503 and no bounty", async () => {
    setup(chainSaying({ "1": "down" }));
    expect((await post({ escrowId: "1" })).status).toBe(503);
    expect(bounties.all()).toHaveLength(0);
  });

  test("a server with no escrow reader refuses a backed bounty rather than taking it on faith", async () => {
    setup(undefined);
    expect((await post({ escrowId: "1" })).status).toBe(503);
  });
});

describe("the money, the deadline and the poster come from the chain", () => {
  test("a listing cannot claim more than the escrow holds", async () => {
    const r = await post({ escrowId: "1", amount: "1000000.00" });
    expect(r.status).toBe(201);
    expect((await r.json() as { amount: string }).amount).toBe(format(usdc("500")));
  });

  test("a listing cannot outlive the escrow behind it", async () => {
    const escrowEnds = Date.now() + 2 * WEEK;
    setup(chainSaying({ "1": { deadline: escrowEnds } }));
    const r = await post({ escrowId: "1", deadline: Date.now() + 52 * WEEK });
    expect((await r.json() as { deadline: number }).deadline).toBe(escrowEnds);
  });

  /**
   * Which is why no posting fee and no signature are needed to prove who a poster is: the contract
   * already records it. A listing pointing at somebody else's escrow names them, not the sender.
   */
  test("the poster is whoever funded it, not whoever sent the request", async () => {
    const r = await post({ escrowId: "1" });
    expect((await r.json() as { poster: string }).poster).toBe(POSTER);
  });

  test("an unbacked bounty is still allowed, and says so", async () => {
    const r = await post({ amount: "10.00" });
    expect(r.status).toBe(201);
    const b = await r.json() as { escrowId: string | null; poster: string; awaitingPayout: boolean };
    expect(b.escrowId).toBe(null);
    expect(b.poster).toBe("agent:liar");   // nothing on chain to correct it
  });
});

/** `SPEC.md` has always listed this. Nothing compared the two until the poster came from the chain. */
describe("a poster cannot win their own bounty", () => {
  const solveAs = (id: string, who: string) =>
    handle(new Request(`http://x/bounties/${id}/solve`, {
      method: "POST", headers: { "x-agent": who, "content-type": "application/json" },
      body: JSON.stringify({ answer: 1 }),
    }), deps);

  test("the funder is refused, however correct the answer", async () => {
    const { id } = await (await post({ escrowId: "1" })).json() as { id: string };
    const r = await solveAs(id, POSTER);
    expect(r.status).toBe(409);
    expect((await r.json() as { error: string }).error).toContain("cannot be won by whoever posted it");
    expect(bounties.get(id)!.solvedBy).toBe(null);
  });

  test("case in an address does not let it through", async () => {
    const { id } = await (await post({ escrowId: "1" })).json() as { id: string };
    expect((await solveAs(id, POSTER.toLowerCase())).status).toBe(409);
  });

  test("anyone else still wins it", async () => {
    const { id } = await (await post({ escrowId: "1" })).json() as { id: string };
    const r = await solveAs(id, "0x00000000000000000000000000000000000000ff");
    expect(r.status).toBe(200);
    expect((await r.json() as { solved: boolean }).solved).toBe(true);
  });
});
