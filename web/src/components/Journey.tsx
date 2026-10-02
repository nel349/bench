import type { ReactNode } from "react";
import { viewHref } from "../plate/useView.ts";
import { PATHS } from "../../../src/paths.ts";
import { CONNECTOR_INSTALL, CONNECTOR_NOTES, promptFor, SKILL_INSTALL, STEPS } from "../lib/journey.ts";
import { CopyLine } from "./CopyLine.tsx";

export interface JourneyProps {
  /** Which steps a connected wallet has done; `null` when no wallet is connected. */
  readonly progress: readonly boolean[] | null;
  /** Where Connect wallet goes, to offer it before the steps when nothing is connected. */
  readonly connectHref: string | null;
  /** The connected wallet, for step 5's link to its page. */
  readonly owner: string | null;
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
export function Journey({ wallet, gym, progress, connectHref, owner }: JourneyProps) {
  /**
   * On a phone the laptop's steps cannot be done, so their commands give way to this page's address,
   * to open on the laptop. Both are drawn and the screen's width picks one: see `.laptop-only`.
   */
  const onLaptop = (laptopPart: ReactNode) => (
    <>
      <div className="laptop-only">{laptopPart}</div>
      <div className="phone-note">
        <p className="fine">This step is on your laptop. Open this page there:</p>
        <CopyLine text={`${gym}${PATHS.fund}`} label="this page's address" />
      </div>
    </>
  );
  const extras: readonly ReactNode[] = [
    <>
      <a className="btn primary open-wallet" href={wallet} target="_blank" rel="noreferrer">Open the wallet</a>
      <p className="fine laptop-only">On a laptop? Type <b className="url">{wallet.replace(/^https:\/\//, "")}</b> into
        your phone. Its wallet screen has the button for test USDC.</p>
    </>,
    onLaptop(<>
      <CopyLine text={SKILL_INSTALL} label="the skill's install line" />
      <CopyLine text={CONNECTOR_INSTALL} label="the connector's install line" />
      <p className="fine">Nothing else to set up on testnet. Restart your agent, then ask it for its
        pairing code. Cursor and Codex: <a href={CONNECTOR_NOTES} target="_blank" rel="noreferrer">the
        connector&rsquo;s notes</a>.</p>
    </>),
    null,
    onLaptop(<CopyLine text={promptFor(gym)} label="the sentence for your agent" />),
    owner !== null ? <a className="btn open-wallet" href={viewHref("yours", owner)}>Watch on Your agents</a> : null,
  ];
  // The first step not yet done is the one to do now.
  const next = progress === null ? -1 : progress.findIndex((done) => !done);
  return (
    <>
      {progress === null && connectHref !== null && (
        <div className="journey-connect">
          <p>Connect your wallet, and these steps tick themselves off as you do them.</p>
          <a className="btn" href={connectHref}>Connect wallet</a>
        </div>
      )}
    <ol className="journey">
      {STEPS.map((step, i) => (
        <li key={step.title} className={progress?.[i] ? "done" : i === next ? "next" : undefined}>
          <span className="step-n" aria-label={progress?.[i] ? `Step ${i + 1}, done` : `Step ${i + 1}`}>
            {progress?.[i] ? "✓" : i + 1}
          </span>
          <div className="step-body">
            <h3>{step.title} <span className="where">{step.where}</span></h3>
            <p>{step.detail}</p>
            {extras[i]}
          </div>
        </li>
      ))}
    </ol>
    </>
  );
}
