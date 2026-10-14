import { Explained } from "../shared/components/Explained.tsx";
import { FormattedMessage, useIntl } from "react-intl";
import type { MessageId } from "../strings/StringsProvider.tsx";
import { useState } from "react";
import { useNetwork } from "../shared/network/NetworkProvider.tsx";
import { Plate } from "../shell/Plate.tsx";
import { Nav } from "../shell/Nav.tsx";
import { Journey } from "./Journey.tsx";
import { OwnKeySteps } from "./OwnKeySteps.tsx";
import { Unguided } from "./Unguided.tsx";
import { Masthead } from "../shell/Masthead.tsx";
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
  readonly probePrice: string;
  /** This gym's address, for the sentence the agent is given. */
  readonly gym: string;
  readonly initialAgent: string | null;
}

/**
 * Start: set up an agent, by giving it something to spend, and tell it to train.
 *
 * The first thing an owner does. The way offered first is an allowance from the owner's wallet: a limit
 * the chain enforces, and one that can be revoked. An agent that brings its own key can be given a
 * balance instead, which is the second way, and a link carrying `?agent=` opens on it because that
 * link names a key.
 *
 * Where no phone wallet serves the network there is no first way. The page then says so, sends a
 * newcomer to the network where the guided setup runs, and sets out the second way in full for the
 * developer whose agent pays for itself.
 */
export function SetUp({ probePrice, gym, initialAgent }: SetUpProps) {
  // The owner's wallet. `null` where none serves this network, which leaves only the agent's own key.
  const { chain, testnet: testMoney, walletUrl: wallet } = useNetwork();
  const [way, setWay] = useState<Way>(wallet !== null && initialAgent === null ? "allowance" : "own-key");
  const ownerWallet = useOwnerWallet();
  const owner = useOwner(ownerWallet.owner);
  const ownerFunds = useOwnerFunds(ownerWallet.owner);
  // Known only once the wallet's page has been read; until then the steps are shown plain.
  const progress = ownerWallet.owner === null || owner.data === undefined ? null : setupProgress(ownerFunds.data, owner.data);
  const panel = useMoreBelow<HTMLElement>();
  const intl = useIntl();
  const testnet = String(testMoney);
  const tab = (id: Way, label: MessageId) => (
    <button type="button" aria-pressed={way === id}
            className={way === id ? "way on" : "way"} onClick={() => setWay(id)}>
      <FormattedMessage id={label} />
    </button>
  );

  /** The guided way, with a phone wallet and an allowance, is offered only where that wallet works. */
  const guided = wallet !== null;
  const allowance = guided && way === "allowance";

  return (
    <Plate
      top={{ start: <Masthead home={PATHS.index} />, end: <Nav current="start" wallet={ownerWallet} /> }}
      left={<FormattedMessage id="frame.network" values={{ testnet, id: chain.id }} />}
      right={<FormattedMessage id={allowance ? "frame.allowanceEdge" : "frame.ownWalletEdge"} />}
      bottom={{ end: <FormattedMessage id="frame.money" values={{ testnet }} /> }}
    >
      <div className="load">
        <section className="load-intro">
          <p className="kicker"><span>//</span> <FormattedMessage id="setup.kicker" /></p>
          {guided ? (
            <>
              <h1 className="headline small">
                <FormattedMessage id="setup.title1" /><br />
                <FormattedMessage id={allowance ? "setup.title2Allowance" : "setup.title2Own"} />
              </h1>
              <Explained about="setup.aboutPage" head={
                <p className="sub"><FormattedMessage id={allowance ? "setup.leadAllowance" : "setup.leadOwn"} /></p>
              }>
                <p><FormattedMessage id={allowance ? "setup.subAllowance" : "setup.subOwn"} values={{ price: asDollars(probePrice) }} /></p>
              </Explained>
            </>
          ) : <Unguided />}
        </section>

        <div className="load-side">
          <section className="load-panel" ref={panel.ref}>
            {guided && (
              <div className="ways" role="group" aria-label={intl.formatMessage({ id: "setup.ways" })}>
                {tab("allowance", "setup.wayAllowance")}
                {tab("own-key", "setup.wayOwn")}
              </div>
            )}
            {allowance
              ? <Journey wallet={wallet} gym={gym} progress={progress} connectHref={ownerWallet.owner === null ? ownerWallet.connectHref : null}
                         onConnect={ownerWallet.beginConnect}
                         owner={ownerWallet.owner} />
              : <OwnKeySteps gym={gym} initialAgent={initialAgent} />}
          </section>
          {/* Under the panel, and not floating in it: there it sat on top of the sentence an owner has to copy. */}
          {panel.more && <button type="button" className="more-below" onClick={panel.showMore}>
            <FormattedMessage id="setup.moreBelow" />
          </button>}
        </div>
      </div>
    </Plate>
  );
}
