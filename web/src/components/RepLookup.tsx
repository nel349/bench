import { useEffect, useState, type FormEvent } from "react";
import { useAgentRecord, useChainRating, useProblems } from "../api/useGym.ts";
import { ApiError } from "../api/client.ts";
import { whoIs } from "../lib/who.ts";
import { short } from "../lib/elapsed.ts";
import { Amount } from "./Amount.tsx";
import { LEVEL_WEIGHT } from "../../../src/problems/problem.ts";

export interface RepLookupProps {
  /** Who the address bar says is being looked up: the part of `#ledger/…` after the view. */
  readonly looking: string;
  /** The reputation registry, so a reader can check the number without us. `null` where there is none. */
  readonly registry: string | null;
  readonly explorer: string;
}

/**
 * Anyone's rep, looked up the way a bounty poster would.
 *
 * An ERC-8004 id gets the number the bounty gate reads: from the registry, counting only the entries
 * the gym's scribe wrote, with enough said to check it there without trusting this page. An address
 * gets the runs it paid for, which is our own record rather than the credential. The lookup lives in
 * the URL, so a result can be linked to.
 */
export function RepLookup({ looking, registry, explorer }: RepLookupProps) {
  const [draft, setDraft] = useState(looking);
  useEffect(() => setDraft(looking), [looking]);

  const who = whoIs(looking);
  const problems = useProblems();
  const rating = useChainRating(who.kind === "identity" ? who.id : null);
  const record = useAgentRecord(who.kind === "address" ? who.address : null);
  const ceiling = (problems.data ?? []).reduce((t, p) => t + LEVEL_WEIGHT[p.level], 0);
  const titleOf = (id: string) => problems.data?.find((p) => p.id === id)?.title ?? id;
  const levelOf = (id: string) => problems.data?.find((p) => p.id === id)?.level;

  const look = (e: FormEvent) => {
    e.preventDefault();
    window.location.hash = `#ledger/${draft.trim()}`;
  };

  return (
    <section className="rep-lookup load-panel" aria-label="Look up an agent's rep">
      <form className="lookup" onSubmit={look}>
        <label htmlFor="who">Look up rep: an ERC-8004 id, or the address an agent pays from</label>
        <div className="field-row">
          <input id="who" value={draft} onChange={(e) => setDraft(e.target.value)}
                 placeholder="894767  or  0x…" spellCheck={false} autoComplete="off" />
          <button className="btn" type="submit" disabled={whoIs(draft).kind === "neither"}>Look up</button>
        </div>
      </form>

      {looking !== "" && who.kind === "neither" && (
        <p className="state bad">That is neither an ERC-8004 id nor an address.</p>
      )}

      {who.kind === "identity" && rating.isError && (
        <p className="state bad">
          {rating.error instanceof ApiError && rating.error.status === 404
            ? "This server has no reputation registry, so there is no rep here to read."
            : "The registry could not be read just now. Try again in a moment."}
        </p>
      )}
      {who.kind === "identity" && rating.data && (
        <div className="rep-result">
          <p className="rep-figure"><span className="rep-n">{rating.data.rating}</span>
            <span className="rep-of">/ {ceiling} rep</span></p>
          {rating.data.ranked.length === 0 ? (
            <p className="state idle">Identity {rating.data.agent} has no ranked runs yet. A solved run ranked for
              $0.25 is what puts rep here.</p>
          ) : (
            <ul className="rep-ranked">
              {rating.data.ranked.map((id) => {
                const level = levelOf(id);
                return <li key={id}><span>{titleOf(id)}</span>{level && <b>+{LEVEL_WEIGHT[level]}</b>}</li>;
              })}
            </ul>
          )}
          <p className="fine">
            Read from ERC-8004 for identity {rating.data.agent}, counting only entries written by the scribe{" "}
            <a href={`${explorer}/address/${rating.data.scribe}`}>{short(rating.data.scribe)}</a>.
            {registry && <> Check it yourself: <code>readAllFeedback</code> on the registry{" "}
              <a href={`${explorer}/address/${registry}`}>{short(registry)}</a>, with the scribe as the only
              client and <code>cost-usdc</code> as the second tag.</>}
          </p>
        </div>
      )}

      {who.kind === "address" && record.data && (
        <div className="rep-result">
          {record.data.attempts === 0 ? (
            <p className="state idle">No run has been paid for by {short(who.address)} here yet.</p>
          ) : (
            <dl className="balances">
              <div className="balance"><dt>Runs paid for</dt><dd>{record.data.attempts}</dd></div>
              <div className="balance"><dt>Solved</dt><dd>{record.data.solved}</dd></div>
              <div className="balance"><dt>Ran out</dt><dd>{record.data.refused}</dd></div>
              <div className="balance"><dt>Spent solving</dt><dd><Amount value={record.data.spend} /></dd></div>
            </dl>
          )}
          <p className="fine">This is our record of the runs this address paid for. Rep, the number a bounty
            reads, is on the agent's ERC-8004 identity: look that up by its id.</p>
        </div>
      )}
    </section>
  );
}
