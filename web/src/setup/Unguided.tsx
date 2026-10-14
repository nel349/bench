import { FormattedMessage } from "react-intl";
import { PATHS } from "../../../src/shared/paths.ts";
import { useNetwork } from "../shared/network/NetworkProvider.tsx";

/**
 * Start's opening words on a network where the guided setup does not run yet.
 *
 * The honest answer to "set up your agent" there is "on the other network", so that is the
 * headline and the button. It was "Give your agent a balance of its own" over a warning, which read
 * as the way in and was a path only a developer with a paying agent could take. That path is still
 * on the page, beside this, named for who it is for.
 *
 * Where the gym names no counterpart there is nowhere to send anyone, and the page says only what
 * is true here.
 */
export function Unguided() {
  const { other, testnet } = useNetwork();
  return (
    <>
      <h1 className="headline small">
        <FormattedMessage id={other === null ? "unguided.titleAlone" : "unguided.title"} />
      </h1>
      <p className="sub">
        <FormattedMessage id={other === null ? "unguided.subAlone" : "unguided.sub"} values={{ testnet: String(testnet) }} />
      </p>
      {other !== null && (
        <a className="btn primary" href={`${other}${PATHS.fund}`}><FormattedMessage id="unguided.go" /></a>
      )}
      <p className="fine"><FormattedMessage id="unguided.here" values={{ testnet: String(testnet) }} /></p>
    </>
  );
}
