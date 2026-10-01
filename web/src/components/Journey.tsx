import type { ReactNode } from "react";
import { CONNECTOR_INSTALL, CONNECTOR_NOTES, promptFor, SKILL_INSTALL, STEPS } from "../lib/journey.ts";
import { CopyLine } from "./CopyLine.tsx";

export interface JourneyProps {
  /** The owner's wallet. Never null here: the page offers this path only where there is one. */
  readonly wallet: string;
  /** This gym's address, for the sentence the agent is given. */
  readonly gym: string;
}

/**
 * The five steps, each with what it needs in the one place it is needed.
 *
 * The titles and sentences come from `STEPS`. What is added here is only what a page can do that a
 * list cannot: the wallet's link on step 1, the lines to copy on step 2, the sentence on step 4.
 */
export function Journey({ wallet, gym }: JourneyProps) {
  const extras: readonly ReactNode[] = [
    <>
      <a className="btn primary open-wallet" href={wallet} target="_blank" rel="noreferrer">Open the wallet</a>
      <p className="fine">On a laptop? Type <b className="url">{wallet.replace(/^https:\/\//, "")}</b> into
        your phone. Its wallet screen has the button for test USDC.</p>
    </>,
    <>
      <CopyLine text={SKILL_INSTALL} label="the skill's install line" />
      <CopyLine text={CONNECTOR_INSTALL} label="the connector's install line" />
      <p className="fine">Nothing else to set up on testnet. Restart your agent, then ask it for its
        pairing code. Cursor and Codex: <a href={CONNECTOR_NOTES} target="_blank" rel="noreferrer">the
        connector&rsquo;s notes</a>.</p>
    </>,
    null,
    <>
      <CopyLine text={promptFor(gym)} label="the sentence for your agent" />
    </>,
    null,
  ];
  return (
    <ol className="journey">
      {STEPS.map((step, i) => (
        <li key={step.title}>
          <span className="step-n">{i + 1}</span>
          <div className="step-body">
            <h3>{step.title} <span className="where">{step.where}</span></h3>
            <p>{step.detail}</p>
            {extras[i]}
          </div>
        </li>
      ))}
    </ol>
  );
}
