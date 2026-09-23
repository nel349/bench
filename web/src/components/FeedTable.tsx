import type { FeedRowWire } from "../../../src/wire.ts";
import { asDollars } from "../lib/money.ts";
import { short, since } from "../lib/elapsed.ts";

export interface FeedTableProps {
  readonly runs: readonly FeedRowWire[];
}

/**
 * Recent runs.
 *
 * `payer` sits beside the agent's name rather than replacing it, because they answer different
 * questions: the name is what an agent calls itself and the address is what its money proves. A
 * table showing only the name would be reporting a header as though it were a fact.
 */
export function FeedTable({ runs }: FeedTableProps) {
  if (runs.length === 0) {
    return <p className="empty">Nothing yet. The first run shows up here.</p>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Agent</th><th>Problem</th><th>Outcome</th>
          <th className="num">Probes</th><th className="num">Spent</th><th className="num">Started</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.attempt}>
            <td>
              <span className="agent">{run.agent}</span>
              {run.payer && <div className="proof">paid by {short(run.payer)}</div>}
            </td>
            <td>{run.problem}</td>
            <td><span className={`tag ${run.endedBy}`}>{run.endedBy}</span></td>
            <td className="num">{run.probes}</td>
            <td className="num">{asDollars(run.spend)}</td>
            <td className="num">{since(run.startedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
