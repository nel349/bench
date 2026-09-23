import { useCallback, useState } from "react";
import { useAccount, useConnect, useSwitchChain, useWriteContract, useConfig } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { parseUnits, type Address, type Hex } from "viem";
import { GATEWAY_ABI, USDC_ABI } from "./abi.ts";
import type { ArcChainId } from "./arc.ts";
import { wasDeclined } from "./errors.ts";

/** USDC's ERC-20 view has six decimals; the native balance has eighteen. Confusing them is a million-fold error. */
const USDC_DECIMALS = 6;

/**
 * Where the flow has got to.
 *
 * A union rather than a status string and a separate message, so a state that carries a
 * transaction hash cannot exist without one and "sending" cannot also be "done".
 */
export type Funding =
  | { readonly step: "idle" }
  | { readonly step: "connecting" }
  | { readonly step: "allowing" }
  | { readonly step: "sending" }
  | { readonly step: "settling"; readonly tx: Hex }
  | { readonly step: "sent"; readonly tx: Hex }
  | { readonly step: "declined" }
  | { readonly step: "failed"; readonly because: string };

export interface FundAgent {
  readonly contracts: { readonly usdc: Address; readonly gateway: Address };
  readonly chainId: ArcChainId;
  readonly agent: Address;
}

/**
 * Give an agent money, in the two transactions it takes.
 *
 * `depositFor` pulls with `transferFrom`, so the allowance has to land first — they cannot be
 * batched from an ordinary wallet, and pretending otherwise would leave the first one stranded.
 *
 * This is the only place in the app that writes to a chain. The page it replaces did all of it
 * inline in a browser script that nothing typechecked.
 */
export function useFundAgent({ contracts, chainId, agent }: FundAgent) {
  const [state, setState] = useState<Funding>({ step: "idle" });
  const { isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const config = useConfig();

  const fund = useCallback(async (usd: string) => {
    const amount = parseUnits(usd, USDC_DECIMALS);

    try {
      if (!isConnected) {
        setState({ step: "connecting" });
        const injected = connectors[0];
        if (!injected) {
          setState({ step: "failed", because: "No wallet was found in this browser." });
          return;
        }
        await connectAsync({ connector: injected });
      }

      // Asked for every time rather than remembered: a person can change network between attempts.
      await switchChainAsync({ chainId });

      setState({ step: "allowing" });
      const allowance = await writeContractAsync({
        address: contracts.usdc, abi: USDC_ABI, functionName: "approve",
        args: [contracts.gateway, amount], chainId,
      });
      // Waited for, not fired and forgotten: the deposit reverts if the allowance has not landed.
      await waitForTransactionReceipt(config, { hash: allowance, chainId });

      setState({ step: "sending" });
      const tx = await writeContractAsync({
        address: contracts.gateway, abi: GATEWAY_ABI, functionName: "depositFor",
        args: [contracts.usdc, agent, amount], chainId,
      });

      setState({ step: "settling", tx });
      const receipt = await waitForTransactionReceipt(config, { hash: tx, chainId });
      if (receipt.status !== "success") {
        setState({ step: "failed", because: "The transfer was included and then reverted." });
        return;
      }
      setState({ step: "sent", tx });
    } catch (error) {
      // Being turned down is an answer. Reporting it as a failure sends somebody looking for a fault.
      if (wasDeclined(error)) { setState({ step: "declined" }); return; }
      setState({
        step: "failed",
        because: error instanceof Error ? error.message.split("\n")[0] ?? "Unknown" : "Unknown",
      });
    }
  }, [isConnected, connectAsync, connectors, switchChainAsync, writeContractAsync, config, contracts, chainId, agent]);

  const reset = useCallback(() => setState({ step: "idle" }), []);
  const busy = state.step !== "idle" && state.step !== "sent"
    && state.step !== "declined" && state.step !== "failed";

  return { state, fund, reset, busy };
}
