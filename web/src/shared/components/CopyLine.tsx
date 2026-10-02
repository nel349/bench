import { FormattedMessage, useIntl } from "react-intl";
import type { MessageId } from "../../strings/StringsProvider.tsx";
import { useCopy } from "../lib/useCopy.ts";

export interface CopyLineProps {
  readonly text: string;
  /** What the line is, for a screen reader: the button reads "Copy" and nothing else. */
  readonly label: MessageId;
}

/** A line to paste somewhere else, shown whole, with a button that copies it. */
export function CopyLine({ text, label }: CopyLineProps) {
  const { copied, copy } = useCopy();
  const intl = useIntl();
  return (
    <div className="copy-line">
      <code>{text}</code>
      <button type="button" className="copy" aria-label={intl.formatMessage({ id: "copy.label" }, { what: intl.formatMessage({ id: label }) })}
              onClick={() => void copy(text)}>
        <FormattedMessage id={copied ? "copy.copied" : "copy.copy"} />
      </button>
    </div>
  );
}
