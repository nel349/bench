import { useQuery } from "@tanstack/react-query";
import type { BountyWire, FeedRowWire, ProblemWire } from "../../../src/wire.ts";
import { getJson } from "./client.ts";

/** How often the wall refreshes. Runs land every few seconds at most; this is not a ticker. */
const FEED_REFRESH_MS = 5_000;

/** The problems on offer. They change when we deploy, not while somebody is reading. */
export function useProblems() {
  return useQuery({
    queryKey: ["problems"],
    queryFn: ({ signal }) => getJson<readonly ProblemWire[]>("/problems", signal),
    staleTime: Infinity,
  });
}

/** Work somebody else is paying for. */
export function useBounties() {
  return useQuery({
    queryKey: ["bounties"],
    queryFn: ({ signal }) => getJson<readonly BountyWire[]>("/bounties", signal),
    refetchInterval: FEED_REFRESH_MS,
  });
}

/**
 * Recent runs, refusals included.
 *
 * A leaderboard says who won. This says what it cost and who ran out, which is the part that makes
 * the number mean anything — so a refusal is never filtered out of it.
 */
export function useFeed() {
  return useQuery({
    queryKey: ["feed"],
    queryFn: ({ signal }) => getJson<readonly FeedRowWire[]>("/feed", signal),
    refetchInterval: FEED_REFRESH_MS,
  });
}
