import { FormattedMessage } from "react-intl";
import { useState } from "react";
import { isAddress, type Address } from "viem";
import { useFunds } from "./useFunds.ts";
import { useFundAgent } from "./useFundAgent.ts";
import { useNetwork } from "../shared/network/NetworkProvider.tsx";
import { Balance } from "./Balance.tsx";
import { AmountChoice } from "./AmountChoice.tsx";
import { FundingProgress } from "./FundingProgress.tsx";
import { standingOf } from "./standing.ts";

/** What a person is offered. Three choices decide faster than a free field. */
const AMOUNTS = ["1", "5", "25"] as const;

/** Stands in while no address is confirmed. The funding controls are not rendered in that state. */
const ZERO = "0x0000000000000000000000000000000000000000" as const;

export interface DepositPanelProps {
  readonly initialAgent: string | null;
}

/**
 * An agent's balance: look its address up, and add to it from the wallet in this browser.
 *
 * For an agent that brings a key of its own rather than the connector, as one step of
 * `OwnKeySteps`. There is no allowance on this path: what is added is the agent's, and the most it
 * can spend.
 */
export function DepositPanel({ initialAgent }: DepositPanelProps) {
  const { chain, usdc, gateway } = useNetwork();
  const [typed, setTyped] = useState(initialAgent ?? "");
  const [agent, setAgent] = useState<string | null>(initialAgent);
  const funds = useFunds(agent);
  const standing = standingOf(funds.data);

  /**
   * Funding follows the **checked** address, never what is currently in the box. Reading the box
   * meant editing it without pressing Check would send money to one agent while the balances on
   * screen described another.
   */
  const confirmed: Address | null = agent !== null && isAddress(agent) ? agent : null;
  const funding = useFundAgent({ contracts: { usdc, gateway }, chainId: chain.id, agent: confirmed ?? ZERO });

  return (
    <>
      <form className="lookup" onSubmit={(e) => { e.preventDefault(); setAgent(typed.trim()); }}>
        <label htmlFor="agent"><FormattedMessage id="deposit.field" /></label>
        <div className="field-row">
          <input id="agent" value={typed} spellCheck={false} autoComplete="off" placeholder="0x…"
                 onChange={(e) => {
                   setTyped(e.target.value);
                   // Clear the result rather than leave it describing an address no longer shown.
                   if (agent !== null && e.target.value.trim() !== agent) setAgent(null);
                 }} />
          <button type="submit" className="btn" disabled={!isAddress(typed.trim())}><FormattedMessage id="deposit.check" /></button>
        </div>
      </form>

      {agent === null && <p className="state idle"><FormattedMessage id="deposit.idle" /></p>}
      {funds.isError && <p className="state bad"><FormattedMessage id="deposit.notAddress" /></p>}
      {standing === "ready" && funds.data && (
        <p className="state good"><FormattedMessage id="deposit.ready" values={{ count: funds.data.probes }} /></p>
      )}
      {standing === "short" && <p className="state wait"><FormattedMessage id="deposit.empty" /></p>}

      {funds.data && (
        <dl className="balances">
          <Balance label={<FormattedMessage id="deposit.balance" />} amount={funds.data.deposit}
                   tone={standing === "ready" ? "ready" : "short"}>
            <FormattedMessage id="deposit.balanceNote" />
          </Balance>
          <Balance label={<FormattedMessage id="deposit.wallet" />} amount={funds.data.wallet} tone="idle">
            <FormattedMessage id={funds.data.wallet === "0.000000" ? "deposit.walletEmpty" : "deposit.walletStray"} />
          </Balance>
        </dl>
      )}

      {funds.data && confirmed && (
        <div className="give">
          {/* Said where the money is, and not before: above the first question it was a warning about nothing yet. */}
          <p className="warn"><FormattedMessage id="deposit.warn" /></p>
          <p className="give-label"><FormattedMessage id="deposit.add" /></p>
          <AmountChoice amounts={AMOUNTS} disabled={funding.busy} onChoose={(usd) => void funding.fund(usd)} />
          <p className="fine"><FormattedMessage id="deposit.confirmations" /></p>
          <FundingProgress state={funding.state} />
        </div>
      )}
    </>
  );
}
