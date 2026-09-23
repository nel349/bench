import { useQuery } from "@tanstack/react-query";
import type { FundsWire } from "../../../src/wire.ts";
import { ApiError, getJson } from "./client.ts";
import { POLL_WHILE_SETTLING_MS } from "../lib/timing.ts";
import { isAddress } from "viem";

/**
 * What an agent holds.
 *
 * Polled only while it matters: a deposit that has just been sent settles in a few seconds, and
 * once it is enough to buy an answer there is nothing left to watch. The old page polled on a bare
 * `setInterval` with a hand-rolled attempt counter and stopped after forty tries whether or not it
 * had succeeded.
 */
export function useFunds(agent: string | null) {
  const valid = agent !== null && isAddress(agent);

  return useQuery({
    queryKey: ["funds", agent],
    enabled: valid,
    queryFn: ({ signal }) => getJson<FundsWire>(`/funds/${agent}`, signal),
    // While it cannot pay, something may be on its way. Once it can, stop asking.
    refetchInterval: (query) => (query.state.data?.ready ? false : POLL_WHILE_SETTLING_MS),
    staleTime: POLL_WHILE_SETTLING_MS,
    // A bad address is an answer, not an outage: retrying it changes nothing. `instanceof` rather
    // than checking `.name`, because a real class exists and duck-typing it would survive a rename.
    retry: (failures, error) => !(error instanceof ApiError && error.status === 404) && failures < 2,
  });
}
