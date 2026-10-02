import { FormattedMessage } from "react-intl";
import { useSay } from "../shared/lib/useSay.ts";
import type { Funding } from "./useFundAgent.ts";

export interface FundingProgressProps {
  readonly state: Funding;
  readonly explorer: string;
}

/**
 * What is happening, in the person's terms.
 *
 * Every branch is named by the union, so a state cannot be rendered without its message and a new
 * one cannot be added without the compiler asking what it says.
 */
export function FundingProgress({ state, explorer }: FundingProgressProps) {
  const say = useSay();
  switch (state.step) {
    case "idle":
      return null;
    case "connecting":
      return <p className="progress"><FormattedMessage id="funding.connecting" /></p>;
    case "allowing":
      return <p className="progress"><FormattedMessage id="funding.allowing" /></p>;
    case "sending":
      return <p className="progress"><FormattedMessage id="funding.sending" /></p>;
    case "settling":
      return <p className="progress"><FormattedMessage id="funding.settling" /></p>;
    case "sent":
      return (
        <p className="progress good">
          <FormattedMessage id="funding.sent" values={{
            link: (chunks) => <a href={`${explorer}/tx/${state.tx}`} target="_blank" rel="noreferrer">{chunks}</a>,
          }} />
        </p>
      );
    case "declined":
      return <p className="progress"><FormattedMessage id="funding.declined" /></p>;
    case "failed":
      return <p className="progress bad"><FormattedMessage id="funding.failed" values={{ because: say(state.because) }} /></p>;
  }
}
