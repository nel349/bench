import { useState } from "react";
import { isAddress, type Address } from "viem";
import { useFunds } from "../api/useFunds.ts";
import { useFundAgent } from "../chain/useFundAgent.ts";
import { chainFor, type ArcChainId } from "../chain/arc.ts";
import { Balance } from "./Balance.tsx";
import { AmountChoice } from "./AmountChoice.tsx";
import { FundingProgress } from "./FundingProgress.tsx";
import { standingOf } from "../lib/standing.ts";

/** What a person is offered. Three choices decide faster than a free field. */
const AMOUNTS = ["1", "5", "25"] as const;

/** Stands in while no address is confirmed. The funding controls are not rendered in that state. */
const ZERO = "0x0000000000000000000000000000000000000000" as const;

export interface DepositPanelProps {
  readonly chainId: ArcChainId;
  readonly usdc: Address;
  readonly gateway: Address;
  readonly initialAgent: string | null;
}

/**
 * Paying from the agent's own key: look it up, and deposit for it from the wallet in this browser.
 *
 * For an agent that brings a key of its own rather than the connector. There is no allowance on
 * this path: what is deposited is the agent's, and the most it can spend.
 */
export function DepositPanel({ chainId, usdc, gateway, initialAgent }: DepositPanelProps) {
  const [typed, setTyped] = useState(initialAgent ?? "");
  const [agent, setAgent] = useState<string | null>(initialAgent);
  const funds = useFunds(agent);
  const standing = standingOf(funds.data);
  const chain = chainFor(chainId);

  /**
   * Funding follows the **checked** address, never what is currently in the box. Reading the box
   * meant editing it without pressing Check would send money to one agent while the balances on
   * screen described another.
   */
  const confirmed: Address | null = agent !== null && isAddress(agent) ? agent : null;
  const funding = useFundAgent({ contracts: { usdc, gateway }, chainId, agent: confirmed ?? ZERO });

  return (
    <>
      <p className="warn">
        <b>This cannot be undone.</b> A deposit belongs to the agent, with no allowance and nothing to
        revoke. Give what you are willing to lose.
      </p>

      <form className="lookup" onSubmit={(e) => { e.preventDefault(); setAgent(typed.trim()); }}>
        <label htmlFor="agent">The address your agent printed when it started</label>
        <div className="field-row">
          <input id="agent" value={typed} spellCheck={false} autoComplete="off" placeholder="0x…"
                 onChange={(e) => {
                   setTyped(e.target.value);
                   // Clear the result rather than leave it describing an address no longer shown.
                   if (agent !== null && e.target.value.trim() !== agent) setAgent(null);
                 }} />
          <button type="submit" className="btn" disabled={!isAddress(typed.trim())}>Check</button>
        </div>
      </form>

      {agent === null && <p className="state idle">Paste an address to see what it holds.</p>}
      {funds.isError && <p className="state bad">That is not an address on this network.</p>}
      {standing === "ready" && funds.data && (
        <p className="state good">
          Loaded. It can ask {funds.data.probes} {funds.data.probes === 1 ? "question" : "questions"}.
        </p>
      )}
      {standing === "short" && <p className="state wait">Empty. It cannot ask anything yet.</p>}

      {funds.data && (
        <dl className="balances">
          <Balance label="Can spend" amount={funds.data.deposit} tone={standing === "ready" ? "ready" : "short"}>
            What it pays for questions with.
          </Balance>
          <Balance label="In its wallet" amount={funds.data.wallet} tone="idle">
            {funds.data.wallet === "0.000000"
              ? "Nothing needs to be here."
              : "Sent here by mistake? This cannot pay for anything. It has to be moved across."}
          </Balance>
        </dl>
      )}

      {funds.data && confirmed && (
        <div className="give">
          <p className="give-label">Add</p>
          <AmountChoice amounts={AMOUNTS} disabled={funding.busy} onChoose={(usd) => void funding.fund(usd)} />
          <p className="fine">Two confirmations in your wallet: one to approve, one to send.</p>
          <FundingProgress state={funding.state} explorer={chain.blockExplorers.default.url} />
        </div>
      )}
    </>
  );
}
