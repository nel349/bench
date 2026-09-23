import type { Funding } from "../chain/useFundAgent.ts";

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
  switch (state.step) {
    case "idle":
      return null;
    case "connecting":
      return <p className="progress">Asking your wallet…</p>;
    case "allowing":
      return <p className="progress">Step 1 of 2. Approve the transfer in your wallet.</p>;
    case "sending":
      return <p className="progress">Step 2 of 2. Send it to your agent from your wallet.</p>;
    case "settling":
      return <p className="progress">Sent. Waiting for the network…</p>;
    case "sent":
      return (
        <p className="progress good">
          Done. <a href={`${explorer}/tx/${state.tx}`} target="_blank" rel="noreferrer">See it on the explorer</a>
        </p>
      );
    case "declined":
      return <p className="progress">You cancelled it. Nothing was sent.</p>;
    case "failed":
      return <p className="progress bad">That did not go through. Nothing was lost. {state.because}</p>;
  }
}
