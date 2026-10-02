import { useState } from "react";
import type { Address } from "viem";
import { chainFor, type ArcChainId } from "../chain/arc.ts";
import { Plate } from "../plate/Plate.tsx";
import { Nav } from "../plate/Nav.tsx";
import { Journey } from "../components/Journey.tsx";
import { DepositPanel } from "../components/DepositPanel.tsx";
import { asDollars } from "../lib/money.ts";
import { PATHS } from "../../../src/paths.ts";
import { useOwnerWallet } from "../lib/ownerWallet.ts";
import { useOwner } from "../api/useGym.ts";
import { useOwnerFunds } from "../api/useFunds.ts";
import { setupProgress } from "../lib/setupProgress.ts";
import { useMoreBelow } from "../lib/useMoreBelow.ts";

/** The two ways an agent can pay here. */
type Way = "allowance" | "own-key";

export interface FundProps {
  readonly chainId: ArcChainId;
  readonly usdc: Address;
  readonly gateway: Address;
  readonly probePrice: string;
  /** The owner's wallet. `null` where none serves this network, which leaves only the agent's own key. */
  readonly wallet: string | null;
  /** This gym's address, for the sentence the agent is given. */
  readonly gym: string;
  readonly initialAgent: string | null;
}

/**
 * Load an agent: give it something to spend.
 *
 * The first step of the loop. The way offered first is an allowance from the owner's wallet: a limit
 * the chain enforces, and one that can be revoked. An agent that brings its own key can be given a
 * deposit instead, which is the second way, and a link carrying `?agent=` opens on it because that
 * link names a key.
 */
export function Fund({ chainId, usdc, gateway, probePrice, wallet, gym, initialAgent }: FundProps) {
  const [way, setWay] = useState<Way>(wallet !== null && initialAgent === null ? "allowance" : "own-key");
  const chain = chainFor(chainId);
  const ownerWallet = useOwnerWallet(wallet);
  const owner = useOwner(ownerWallet.owner);
  const ownerFunds = useOwnerFunds(ownerWallet.owner);
  const progress = ownerWallet.owner === null ? null : setupProgress(ownerFunds.data, owner.data);
  const panel = useMoreBelow<HTMLElement>();
  const tab = (id: Way, label: string) => (
    <button type="button" aria-pressed={way === id}
            className={way === id ? "way on" : "way"} onClick={() => setWay(id)}>
      {label}
    </button>
  );

  return (
    <Plate
      top={{ start: <a className="brand" href={PATHS.index}>BENCH<b>//</b></a>, end: <Nav current="load" wallet={ownerWallet} /> }}
      left={<>ARC {chain.testnet ? "TESTNET" : "MAINNET"} · CHAIN {chain.id}</>}
      right={way === "allowance" ? <>A LIMIT ON CHAIN · REVOKE ANY TIME</> : <>YOUR WALLET MUST BE ON ARC</>}
      bottom={{
        start: <>STEP 00 OF THE LOOP</>,
        middle: <span className="loop-line">LOAD&nbsp;&nbsp;→&nbsp;&nbsp;TRAIN&nbsp;&nbsp;→&nbsp;&nbsp;REP&nbsp;&nbsp;→&nbsp;&nbsp;GIGS</span>,
        end: <>x402 · USDC</>,
      }}
    >
      <div className="load">
        <section className="load-intro">
          <p className="kicker"><span>00</span> load</p>
          {way === "allowance" ? (
            <>
              <h1 className="headline small">Give your agent<br />an <em>allowance</em>.</h1>
              <p className="sub">
                It pays {asDollars(probePrice)} for every question it asks while it trains, from your
                wallet and inside a limit you set on your phone. The chain refuses anything past the
                limit, and you can revoke it in one step.
              </p>
            </>
          ) : (
            <>
              <h1 className="headline small">Give your agent<br />something to <em>spend</em>.</h1>
              <p className="sub">
                It pays {asDollars(probePrice)} for every question it asks while it trains, from a
                deposit made for its own key. What you deposit is the most it can spend.
              </p>
            </>
          )}
          {wallet === null && (
            <p className="warn">
              <b>No wallet serves this network yet.</b> Until one does, an agent here pays from its own
              key.
            </p>
          )}
        </section>

        <section className="load-panel" ref={panel.ref}>
          {wallet !== null && (
            <div className="ways" role="group" aria-label="How your agent pays">
              {tab("allowance", "With an allowance")}
              {tab("own-key", "From its own key")}
            </div>
          )}
          {way === "allowance" && wallet !== null
            ? <Journey wallet={wallet} gym={gym} progress={progress} connectHref={ownerWallet.connectHref}
                       owner={ownerWallet.owner} />
            : <DepositPanel chainId={chainId} usdc={usdc} gateway={gateway} initialAgent={initialAgent} />}
          {panel.more && <button type="button" className="more-below" onClick={panel.showMore}>More steps below</button>}
        </section>
      </div>
    </Plate>
  );
}
