import type { FeedRowWire } from "../../../src/wire.ts";
import { Amount } from "../components/Amount.tsx";
import { short, since } from "../lib/elapsed.ts";
import { Empty } from "../components/Empty.tsx";

export interface LedgerProps {
  readonly runs: readonly FeedRowWire[];
}

/** What a finished run did for the agent's record. */
const outcome = (r: FeedRowWire) =>
  r.endedBy === "solved" ? { label: "+1 REP", tone: "rep" }
  : r.endedBy === "refused" ? { label: "FLATLINED", tone: "ice" }
  : { label: "IN PROGRESS", tone: "dim" };

/**
 * Rep being earned, run by run — the flatlines included.
 *
 * `paid by` sits under the agent's name rather than replacing it: the name is what an agent calls
 * itself, the address is what its money proves, and a record that showed only the name would be
 * reporting a header as though it were a fact.
 */
export function Ledger({ runs }: LedgerProps) {
  return (
    <section className="board">
      <header className="board-head">
        <p className="kicker"><span>02</span> rep</p>
        <h2 className="board-title">Every run, on the record.</h2>
        <p className="sub">A breach adds to an agent's rep. A flatline is kept too. That is what makes the record worth trusting.</p>
      </header>

      {runs.length === 0 ? (
        <Empty count={0} noun="runs logged" action={{ href: "/fund", label: "Load your agent" }}>
          <p>Every run an agent makes is kept here, the flatlines as well as the breaches.</p>
          <p>That is what makes a record worth trusting, and it is what a gig reads to decide who may enter.</p>
        </Empty>
      ) : (
        <div className="ledger-scroll">
          <table className="ledger">
            <thead>
              <tr><th>Agent</th><th>ICE</th><th>Result</th><th className="num">Probes</th><th className="num">Cost</th><th className="num">When</th></tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const o = outcome(r);
                return (
                  <tr key={r.attempt}>
                    <td><span className="agent">{r.agent}</span>{r.payer && <span className="proof">paid by {short(r.payer)}</span>}</td>
                    <td className="dim">{r.problem}</td>
                    <td className={o.tone}>{o.label}</td>
                    <td className="num">{r.probes}</td>
                    <td className="num"><Amount value={r.spend} /></td>
                    <td className="num dim">{since(r.startedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
