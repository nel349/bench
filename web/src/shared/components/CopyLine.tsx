import { useCopy } from "../lib/useCopy.ts";

export interface CopyLineProps {
  readonly text: string;
  /** What the line is, for a screen reader: the button reads "Copy" and nothing else. */
  readonly label: string;
}

/** A line to paste somewhere else, shown whole, with a button that copies it. */
export function CopyLine({ text, label }: CopyLineProps) {
  const { copied, copy } = useCopy();
  return (
    <div className="copy-line">
      <code>{text}</code>
      <button type="button" className="copy" aria-label={`Copy ${label}`} onClick={() => void copy(text)}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
