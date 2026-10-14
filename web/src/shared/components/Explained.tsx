import { useId, useState, type ReactNode } from "react";
import { useIntl } from "react-intl";
import type { MessageId } from "../../strings/StringsProvider.tsx";

export interface ExplainedProps {
  /** What is always shown: a step's title, a page's one line. The "?" sits at its end. */
  readonly head: ReactNode;
  /** What the "?" is about, for a screen reader: "About this step". */
  readonly about: MessageId;
  /** What the name above takes, such as which step it is about, so five steps' "?" are not one name five times. */
  readonly aboutValues?: Readonly<Record<string, string | number>>;
  /** What the "?" opens: the why and the how, for whoever wants them. */
  readonly children: ReactNode;
}

/**
 * A line with a "?" at its end that opens what explains it.
 *
 * Every step and every page said everything at once, so a person who only wanted to do the next
 * thing read a paragraph to find it. The page now shows what to do, and the reasons are a tap away,
 * as the wallet keeps its explanations behind the same mark.
 */
export function Explained({ head, about, aboutValues, children }: ExplainedProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const intl = useIntl();
  return (
    <>
      <div className="explained-head">
        {head}
        <button type="button" className={open ? "hint open" : "hint"} aria-expanded={open} aria-controls={id}
                aria-label={intl.formatMessage({ id: about }, aboutValues)} onClick={() => setOpen((shown) => !shown)}>?</button>
      </div>
      {open && <div className="explained" id={id}>{children}</div>}
    </>
  );
}
