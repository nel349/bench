import { FormattedMessage, useIntl } from "react-intl";
import type { ReactNode } from "react";
import { viewHref } from "../shell/useView.ts";
import { PATHS } from "../../../src/shared/paths.ts";
import { CONNECTOR_INSTALL, CONNECTOR_NOTES, SKILL_INSTALL, STEPS } from "./steps.ts";
import { CopyLine } from "../shared/components/CopyLine.tsx";

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
  const intl = useIntl();
  /**
   * On a phone the laptop's steps cannot be done, so their commands give way to this page's address,
   * to open on the laptop. Both are drawn and the screen's width picks one: see `.laptop-only`.
   */
  const onLaptop = (laptopPart: ReactNode) => (
    <>
      <div className="laptop-only">{laptopPart}</div>
      <div className="phone-note">
        <p className="fine"><FormattedMessage id="setup.onLaptop" /></p>
        <CopyLine text={`${gym}${PATHS.fund}`} label="copy.pageAddress" />
      </div>
    </>
  );
  const extras: readonly ReactNode[] = [
    <>
      <a className="btn primary open-wallet" href={wallet} target="_blank" rel="noreferrer">
        <FormattedMessage id="step1.open" />
      </a>
      <p className="fine laptop-only">
        <FormattedMessage id="step1.laptop" values={{ url: <b className="url">{wallet.replace(/^https:\/\//, "")}</b> }} />
      </p>
    </>,
    onLaptop(<>
      <CopyLine text={SKILL_INSTALL} label="copy.skill" />
      <CopyLine text={CONNECTOR_INSTALL} label="copy.connector" />
      <p className="fine">
        <FormattedMessage id="step2.note" values={{
          link: (chunks) => <a href={CONNECTOR_NOTES} target="_blank" rel="noreferrer">{chunks}</a>,
        }} />
      </p>
    </>),
    null,
    onLaptop(<CopyLine text={intl.formatMessage({ id: "step4.sentence" }, { gym })} label="copy.sentence" />),
    owner !== null
      ? <a className="btn open-wallet" href={viewHref("yours", owner)}><FormattedMessage id="setup.watch" /></a>
      : null,
  ];
  // The first step not yet done is the one to do now.
  const next = progress === null ? -1 : progress.findIndex((done) => !done);
  return (
    <>
      {progress === null && connectHref !== null && (
        <div className="journey-connect">
          <p><FormattedMessage id="setup.connectFirst" /></p>
          <a className="btn" href={connectHref}><FormattedMessage id="wallet.connect" /></a>
        </div>
      )}
    <ol className="journey">
      {STEPS.map((step, i) => (
        <li key={step.n} className={progress?.[i] ? "done" : i === next ? "next" : undefined}>
          <span className="step-n"
                aria-label={intl.formatMessage({ id: progress?.[i] ? "setup.stepDone" : "setup.step" }, { n: step.n })}>
            {progress?.[i] ? "✓" : step.n}
          </span>
          <div className="step-body">
            <h3>
              <FormattedMessage id={`step${step.n}.title`} />{" "}
              <span className="where"><FormattedMessage id={`step.where.${step.where}`} /></span>
            </h3>
            <p><FormattedMessage id={`step${step.n}.detail`} /></p>
            {extras[i]}
          </div>
        </li>
      ))}
    </ol>
    </>
  );
}
