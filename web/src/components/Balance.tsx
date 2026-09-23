import type { ReactNode } from "react";
import { asDollars } from "../lib/money.ts";

export interface BalanceProps {
  readonly label: string;
  readonly amount: string;
  readonly tone: "ready" | "short" | "idle";
  readonly children: ReactNode;
}

/**
 * One balance, with the sentence that says what it is for.
 *
 * The explanation is not decoration. Two balances is the single most likely way for an owner to get
 * stuck: x402 spends the Gateway deposit and not the wallet, so money sent to the right address and
 * the wrong balance simply sits there while the agent is refused for being broke.
 */
export function Balance({ label, amount, tone, children }: BalanceProps) {
  return (
    <div className="balance">
      <dt>{label}</dt>
      <dd className={tone}>{asDollars(amount)}</dd>
      <p>{children}</p>
    </div>
  );
}
