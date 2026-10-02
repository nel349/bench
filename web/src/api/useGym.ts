import { useQuery } from "@tanstack/react-query";
import type {
  AgentRecordWire, BountyWire, ChainRatingWire, FeedRowWire, OwnerWire, ProblemDetailWire, ProblemWire, ScoreWire,
} from "../../../src/wire.ts";
import { PATHS } from "../../../src/paths.ts";
import { ApiError, getJson } from "./client.ts";

/** How often the wall refreshes. Runs land every few seconds at most; this is not a ticker. */
const FEED_REFRESH_MS = 5_000;

/** The problems on offer. They change when we deploy, not while somebody is reading. */
export function useProblems() {
  return useQuery({
    queryKey: ["problems"],
    queryFn: ({ signal }) => getJson<readonly ProblemWire[]>(PATHS.problems, signal),
    staleTime: Infinity,
  });
}

/** One problem in full, with its statement. */
export function useProblem(id: string) {
  return useQuery({
    queryKey: ["problem", id],
    queryFn: ({ signal }) => getJson<ProblemDetailWire>(`${PATHS.problems}/${id}`, signal),
    staleTime: Infinity,
  });
}

/** A problem's board: paid solves, cheapest first. Refreshed like the feed, since runs land on it. */
export function useBoard(id: string) {
  return useQuery({
    queryKey: ["board", id],
    queryFn: ({ signal }) => getJson<readonly ScoreWire[]>(`${PATHS.leaderboard}/${id}`, signal),
    refetchInterval: FEED_REFRESH_MS,
  });
}

/** Work somebody else is paying for. */
export function useBounties() {
  return useQuery({
    queryKey: ["bounties"],
    queryFn: ({ signal }) => getJson<readonly BountyWire[]>(PATHS.bounties, signal),
    refetchInterval: FEED_REFRESH_MS,
  });
}

/**
 * Recent runs someone paid for, refusals included.
 *
 * A leaderboard says who won. This says what it cost and who ran out, which is the part that makes
 * the number mean anything, so a refusal is never filtered out of it.
 */
export function useFeed() {
  return useQuery({
    queryKey: ["feed"],
    queryFn: ({ signal }) => getJson<readonly FeedRowWire[]>(PATHS.feed, signal),
    refetchInterval: FEED_REFRESH_MS,
  });
}

/**
 * An agent's rep, as the bounty gate reads it: from ERC-8004, for an identity. A 404 means this
 * server has no registry to read, which is an answer, so it is not retried.
 */
export function useChainRating(id: string | null) {
  return useQuery({
    queryKey: ["rating", id],
    queryFn: ({ signal }) => getJson<ChainRatingWire>(`${PATHS.rating}/${id}`, signal),
    enabled: id !== null,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1,
  });
}

/** The runs an address paid for. */
export function useAgentRecord(address: string | null) {
  return useQuery({
    queryKey: ["agent", address],
    queryFn: ({ signal }) => getJson<AgentRecordWire>(`${PATHS.agents}/${address}`, signal),
    enabled: address !== null,
  });
}

/** While an agent is playing, its page follows each probe; otherwise it checks now and then. */
const LIVE_REFRESH_MS = 3_000;
const IDLE_REFRESH_MS = 15_000;

/** One owner's page: their wallet's agents, what each is doing, spent and earned. */
export function useOwner(wallet: string | null) {
  return useQuery({
    queryKey: ["owner", wallet],
    queryFn: ({ signal }) => getJson<OwnerWire>(`${PATHS.owner}/${wallet}`, signal),
    enabled: wallet !== null,
    refetchInterval: (query) =>
      query.state.data?.agents.some((a) => a.live !== null) ? LIVE_REFRESH_MS : IDLE_REFRESH_MS,
  });
}

