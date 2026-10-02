import { useIntl } from "react-intl";
export interface AmountChoiceProps {
  readonly amounts: readonly string[];
  readonly disabled: boolean;
  readonly onChoose: (usd: string) => void;
}

/** How much to add. Presentational: it knows nothing about wallets, chains or what happens next. */
export function AmountChoice({ amounts, disabled, onChoose }: AmountChoiceProps) {
  const intl = useIntl();
  return (
    <div className="amounts" role="group" aria-label={intl.formatMessage({ id: "deposit.amounts" })}>
      {amounts.map((usd) => (
        <button key={usd} type="button" className="amount-choice" disabled={disabled}
                onClick={() => onChoose(usd)}>
          ${usd}
        </button>
      ))}
    </div>
  );
}
