import { forReading } from "../lib/money.ts";

export interface AmountProps {
  readonly value: string;
  /** The hero figure on a page, rather than a cell in a column. */
  readonly display?: boolean;
}

/**
 * Money, set the way a ledger sets it.
 *
 * The dollars carry the meaning and the cents are precision, so they are weighted differently: full
 * strength before the point, dimmed after it. It is an old typographic habit from printed accounts
 * and it does something real — a column of figures becomes scannable at the magnitude, and the
 * exactness stays available without shouting.
 *
 * Tabular figures throughout, so decimal points line up down a column without a table cell trick.
 */
export function Amount({ value, display = false }: AmountProps) {
  const [dollars, cents] = forReading(value).split(".");
  return (
    <span className={display ? "amount amount-display" : "amount"}>
      <span className="currency">$</span>
      {dollars}
      <span className="cents">.{cents ?? "00"}</span>
    </span>
  );
}
