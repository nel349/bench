import { FormattedMessage, useIntl } from "react-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { viewHref } from "../shell/useView.ts";
import { whoIs } from "./who.ts";
import { RepResult } from "./RepResult.tsx";

export interface RepLookupProps {
  /** Who the address bar says is being looked up: the part of `#standings/…` after the view. */
  readonly looking: string;
  /**
   * Whether the answer is shown here. Not for an agent pressed in the standings: its answer opens
   * under its own row, and this box stays put instead of jumping above the table.
   */
  readonly showResult: boolean;
}

/**
 * Anyone's rep, looked up the way a gig's poster would: a form, and under it `RepResult`. The lookup
 * lives in the URL, so a result can be linked to.
 */
export function RepLookup({ looking, showResult }: RepLookupProps) {
  const [draft, setDraft] = useState(looking);
  useEffect(() => setDraft(looking), [looking]);
  /**
   * Somebody looked up is shown here, and here is under the standings: pressing an agent's name in
   * the table changed something a screen below and looked as though it had done nothing. So the
   * answer is brought into view. Not for nobody, and not for an answer shown somewhere else.
   */
  const here = useRef<HTMLElement>(null);
  useEffect(() => {
    if (looking !== "" && showResult) here.current?.scrollIntoView?.({ block: "nearest" });
  }, [looking, showResult]);

  const intl = useIntl();
  const look = (e: FormEvent) => {
    e.preventDefault();
    window.location.assign(viewHref("standings", draft.trim()));
  };

  return (
    <section ref={here} className="rep-lookup load-panel" aria-label={intl.formatMessage({ id: "lookup.label" })}>
      <form className="lookup" onSubmit={look}>
        <label htmlFor="who"><FormattedMessage id="lookup.field" /></label>
        <div className="field-row">
          <input id="who" value={draft} onChange={(e) => setDraft(e.target.value)}
                 placeholder={intl.formatMessage({ id: "lookup.placeholder" })} spellCheck={false} autoComplete="off" />
          <button className="btn" type="submit" disabled={whoIs(draft).kind === "neither"}>
            <FormattedMessage id="lookup.submit" />
          </button>
        </div>
      </form>

      {showResult && <RepResult looking={looking} />}
    </section>
  );
}
