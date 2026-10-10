import { FormattedMessage, useIntl } from "react-intl";
import type { MessageId } from "../strings/StringsProvider.tsx";
import { useState } from "react";
import type { Address } from "viem";
import { chainFor, type ArcChainId } from "../shared/chain/arc.ts";
import { Plate } from "../shell/Plate.tsx";
import { Nav } from "../shell/Nav.tsx";
import { Journey } from "./Journey.tsx";
import { DepositPanel } from "./DepositPanel.tsx";
import { asDollars } from "../shared/lib/money.ts";
import { PATHS } from "../../../src/shared/paths.ts";
import { useOwnerWallet } from "../shared/lib/ownerWallet.ts";
import { useOwner } from "../shared/api/useGym.ts";
import { useOwnerFunds } from "./useFunds.ts";
import { setupProgress } from "./progress.ts";
import { useMoreBelow } from "./useMoreBelow.ts";

/** The two ways an agent can pay here. */
type Way = "allowance" | "own-key";

export interface SetUpProps {
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
 * Set up an agent: give it something to spend.
 *
 * The first step of the loop. The way offered first is an allowance from the owner's wallet: a limit
 * the chain enforces, and one that can be revoked. An agent that brings its own key can be given a
 * balance instead, which is the second way, and a link carrying `?agent=` opens on it because that
 * link names a key.
 */
export function SetUp({ chainId, usdc, gateway, probePrice, wallet, gym, initialAgent }: SetUpProps) {
  const [way, setWay] = useState<Way>(wallet !== null && initialAgent === null ? "allowance" : "own-key");
  const chain = chainFor(chainId);
  const ownerWallet = useOwnerWallet(wallet);
  const owner = useOwner(ownerWallet.owner);
  const ownerFunds = useOwnerFunds(ownerWallet.owner);
  // Known only once the wallet's page has been read; until then the steps are shown plain.
  const progress = ownerWallet.owner === null || owner.data === undefined ? null : setupProgress(ownerFunds.data, owner.data);
  const panel = useMoreBelow<HTMLElement>();
  const intl = useIntl();
  const testnet = String(chain.testnet === true);
  const tab = (id: Way, label: MessageId) => (
    <button type="button" aria-pressed={way === id}
            className={way === id ? "way on" : "way"} onClick={() => setWay(id)}>
      <FormattedMessage id={label} />
    </button>
  );

  return (
    <Plate
      top={{ start: <a className="brand" href={PATHS.index}>BENCH<b>//</b></a>, end: <Nav current="load" wallet={ownerWallet} /> }}
      left={<FormattedMessage id="frame.network" values={{ testnet, id: chain.id }} />}
      right={<FormattedMessage id={way === "allowance" ? "frame.allowanceEdge" : "frame.ownWalletEdge"} />}
      bottom={{
        start: <FormattedMessage id="frame.setupStep" />,
        middle: <span className="loop-line"><FormattedMessage id="frame.setupLoop" /></span>,
        end: <FormattedMessage id="frame.money" values={{ testnet }} />,
      }}
    >
      <div className="load">
        <section className="load-intro">
          <p className="kicker"><span>00</span> <FormattedMessage id="setup.kicker" /></p>
          <h1 className="headline small">
            <FormattedMessage id="setup.title1" /><br />
            <FormattedMessage id={way === "allowance" ? "setup.title2Allowance" : "setup.title2Own"} />
          </h1>
          <p className="sub">
            <FormattedMessage id={way === "allowance" ? "setup.subAllowance" : "setup.subOwn"}
                              values={{ price: asDollars(probePrice) }} />
          </p>
          {wallet === null && <p className="warn"><FormattedMessage id="setup.noWallet" /></p>}
        </section>

        <section className="load-panel" ref={panel.ref}>
          {wallet !== null && (
            <div className="ways" role="group" aria-label={intl.formatMessage({ id: "setup.ways" })}>
              {tab("allowance", "setup.wayAllowance")}
              {tab("own-key", "setup.wayOwn")}
            </div>
          )}
          {way === "allowance" && wallet !== null
            ? <Journey wallet={wallet} gym={gym} progress={progress} connectHref={ownerWallet.owner === null ? ownerWallet.connectHref : null}
                       onConnect={ownerWallet.beginConnect}
                       owner={ownerWallet.owner} />
            : <DepositPanel chainId={chainId} usdc={usdc} gateway={gateway} initialAgent={initialAgent} />}
          {panel.more && <button type="button" className="more-below" onClick={panel.showMore}>
            <FormattedMessage id={way === "allowance" && wallet !== null ? "setup.moreBelow" : "setup.moreBelowOwn"} />
          </button>}
        </section>
      </div>
    </Plate>
  );
}
