import { FormattedMessage, useIntl } from "react-intl";
import { CopyLine } from "../shared/components/CopyLine.tsx";
import { useNetwork } from "../shared/network/NetworkProvider.tsx";
import { DepositPanel } from "./DepositPanel.tsx";
import { OWN_KEY_EXAMPLE, SKILL_INSTALL } from "./steps.ts";

export interface OwnKeyStepsProps {
  /** This gym's address, for the sentence the agent is given. */
  readonly gym: string;
  /** An agent's address carried in the link, to open on it. */
  readonly initialAgent: string | null;
}

/**
 * How an agent that pays for itself gets to play, from nothing: what it needs, how it is given
 * money, and how it is sent here.
 *
 * This was one field, "the address your agent printed when it started", under a warning. It took
 * for granted that there was an agent, that it had a key, and that its owner knew what came after;
 * and nothing in the product prints an address on this path. Somebody arriving cold had a form they
 * could not fill in. It is the only way to play where no phone wallet serves the network, so there
 * it was the whole of Start.
 *
 * It says who it is for before it asks for anything. This path is a developer's: the agent needs a
 * key and a way to pay that Bench does not hand out, and the page says so instead of implying
 * five minutes.
 */
export function OwnKeySteps({ gym, initialAgent }: OwnKeyStepsProps) {
  const intl = useIntl();
  const { testnet } = useNetwork();
  return (
    <>
      <p className="own-for"><FormattedMessage id="own.for" /></p>
      <ol className="journey">
        <li>
          <span className="step-n" aria-label={intl.formatMessage({ id: "setup.step" }, { n: 1 })}>1</span>
          <div className="step-body">
            <h3><FormattedMessage id="own1.title" /></h3>
            <p><FormattedMessage id="own1.detail" /></p>
            <p className="fine">
              <FormattedMessage id="own1.example" values={{
                link: (chunks) => <a href={OWN_KEY_EXAMPLE} target="_blank" rel="noreferrer">{chunks}</a>,
              }} />
            </p>
          </div>
        </li>
        <li>
          <span className="step-n" aria-label={intl.formatMessage({ id: "setup.step" }, { n: 2 })}>2</span>
          <div className="step-body">
            <h3><FormattedMessage id="own2.title" /></h3>
            <p><FormattedMessage id="own2.detail" values={{ testnet: String(testnet) }} /></p>
            <DepositPanel initialAgent={initialAgent} />
          </div>
        </li>
        <li className="key">
          <span className="step-n" aria-label={intl.formatMessage({ id: "setup.step" }, { n: 3 })}>3</span>
          <div className="step-body">
            <h3><FormattedMessage id="own3.title" /></h3>
            <p><FormattedMessage id="own3.detail" /></p>
            <CopyLine text={SKILL_INSTALL} label="copy.skill" />
            <CopyLine text={intl.formatMessage({ id: "step4.sentence" }, { gym })} label="copy.sentence" />
          </div>
        </li>
      </ol>
    </>
  );
}
