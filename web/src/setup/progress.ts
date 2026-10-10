import type { FundsWire, OwnerWire } from "../../../src/shared/wire.ts";

/**
 * Which of the five set-up steps a connected wallet has already done, from what the chain and the
 * gym say, so Set up shows where an owner is instead of the same five instructions for everyone.
 *
 * Step 2, connecting the agent, cannot be seen from here: it happens on the owner's laptop. It is
 * done once step 3 is, because an allowance can only be granted to an agent's pairing code, which
 * only the connector shows. Step 5 is watching, which is never finished; it counts as begun once
 * there is something to watch.
 *
 * Granted means the wallet grants to an agent now, whether or not that allowance has since run out
 * or ended: scanning and granting were done, and an owner whose agent spent its whole limit was
 * being shown steps 2 and 3 as still to do. Played counts those agents only, so an agent the wallet
 * no longer grants to does not tick the steps for a new one that has never been told to start.
 *
 * It needs the owner's page to have been read. Until it has, there is nothing to say, and the caller
 * shows the plain steps rather than five of them undone.
 */
export function setupProgress(funds: FundsWire | undefined, owner: OwnerWire): readonly boolean[] {
  const funded = funds !== undefined && Number(funds.wallet) > 0;
  const granting = owner.agents.filter((a) => a.current);
  const granted = granting.length > 0;
  const played = granting.some((a) => a.runs.length > 0);
  return [funded || granted, granted, granted, played, played];
}
