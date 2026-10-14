import { FormattedMessage, useIntl } from "react-intl";
import { useState } from "react";
import { CopyLine } from "../shared/components/CopyLine.tsx";
import { AGENTS, connectorSetup, type Agent } from "./steps.ts";
import { useNetwork } from "../shared/network/NetworkProvider.tsx";

/** What each agent is called on the page. Product names, so not translated. */
const NAMES: Readonly<Record<Agent, string>> = { claude: "Claude Code", cursor: "Cursor", codex: "Codex" };

/**
 * The connector's setup, for the agent the owner runs.
 *
 * The first screen says Claude Code, Cursor or Codex, and step 2 had a line for Claude Code alone,
 * with the other two sent to a README that had nothing for them. Each now gets its own: a command
 * for Claude Code, and the settings for the other two, which add a server from a file.
 */
export function ConnectorFor() {
  const [agent, setAgent] = useState<Agent>("claude");
  const setup = connectorSetup(useNetwork().testnet);
  const intl = useIntl();
  return (
    <div className="connector-for">
      <div className="agent-pick" role="group" aria-label={intl.formatMessage({ id: "step2.which" })}>
        {AGENTS.map((a) => (
          <button key={a} type="button" aria-pressed={agent === a} className={agent === a ? "on" : undefined}
                  onClick={() => setAgent(a)}>{NAMES[a]}</button>
        ))}
      </div>
      {agent === "claude" && <CopyLine text={setup.claude} label="copy.connector" />}
      {agent === "cursor" && <>
        <p className="fine"><FormattedMessage id="step2.cursorWhere" /></p>
        <CopyLine text={setup.cursor} label="copy.connectorConfig" />
      </>}
      {agent === "codex" && <>
        <p className="fine"><FormattedMessage id="step2.codexWhere" /></p>
        <CopyLine text={setup.codex} label="copy.connectorConfig" />
      </>}
    </div>
  );
}
