import type { FundsWire, OwnerWire } from "../../../src/wire.ts";

/**
 * Which of the five set-up steps a connected wallet has already done, from what the chain and the
 * gym say, so Set up shows where an owner is instead of the same five instructions for everyone.
 *
 * Step 2, connecting the agent, cannot be seen from here: it happens on the owner's laptop. It is
 * done once step 3 is, because an allowance can only be granted to an agent's pairing code, which
 * only the connector shows. Step 5 is watching, which is never finished; it counts as begun once
 * there is something to watch.
 */
export function setupProgress(funds: FundsWire | undefined, owner: OwnerWire | undefined): readonly boolean[] {
  const funded = funds !== undefined && Number(funds.wallet) > 0;
  const granted = owner?.agents.some((a) => a.current && a.allowance?.live === true) ?? false;
  const played = owner?.agents.some((a) => a.runs.length > 0) ?? false;
  return [funded || granted, granted, granted, played, played];
}
