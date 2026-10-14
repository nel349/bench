import { FormattedMessage } from "react-intl";
import type { ZendoSample as Zendo } from "./sample.ts";

/** How many steps Zendo's drawing takes: one per question, then the rule named. */
export const zendoSteps = (s: Zendo) => s.asked.length + 1;

/** Zendo's triples asked one at a time with the answer each gets, and the hidden rule named once they are all in. */
export function ZendoSample({ sample, label, step }: { readonly sample: Zendo; readonly label: string; readonly step: number }) {
  const named = step > sample.asked.length;
  return (
    <div className="sample-draw zendo" role="img" aria-label={label}>
      <p className={named ? "rule" : "rule hidden"}>{named ? sample.rule : <FormattedMessage id="sample.ruleHidden" />}</p>
      <ul>
        {sample.asked.map(({ triple, holds }, i) => (
          <li key={triple.join(",")} className={`${holds ? "yes" : "no"}${i < step ? "" : " pending"}`}>
            <span className="triple">{triple.map((n, j) => <b key={j}>{n}</b>)}</span>
            <span className="answer"><FormattedMessage id={holds ? "sample.yes" : "sample.no"} /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
