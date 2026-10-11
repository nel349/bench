import { FormattedMessage } from "react-intl";
import type { MessageId } from "../strings/StringsProvider.tsx";
import type { StandingWire } from "../../../src/shared/wire.ts";
import { Amount } from "../shared/components/Amount.tsx";
import { viewHref } from "./useView.ts";
import { PATHS } from "../../../src/shared/paths.ts";

export interface FirstScreenProps {
  readonly testnet: boolean;
  /** The agent ahead of the rest, or `null` while none has recorded a solve. */
  readonly leader: Pick<StandingWire, "identity" | "rep"> | null;
  /** The cheapest record there is, and the exercise it is on. `null` while there is none. */
  readonly cheapest: { readonly title: string; readonly spend: string } | null;
  /** How many agents have recorded a solve, and the runs they have paid for between them. */
  readonly agents: number;
  readonly runs: number;
  /** The gigs open now and what they pay between them. `null` while none is open. */
  readonly gigs: { readonly count: number; readonly onOffer: string } | null;
}

/** What an owner does, in the order they do it. Three things, and the agent does the rest. */
const HOW: readonly { readonly title: MessageId; readonly detail: MessageId }[] = [
  { title: "home.how1.title", detail: "home.how1.detail" },
  { title: "home.how2.title", detail: "home.how2.detail" },
  { title: "home.how3.title", detail: "home.how3.detail" },
];

/**
 * What a visitor sees first: what Bench is for, said to the person whose agent it is, the one way
 * in, and what they will be asked to do.
 *
 * It used to lead with gigs and rep, which are the gym's words for its own workings, beside a demo
 * of one exercise. Somebody arriving could watch a ray cross a grid and still not know what the
 * place would do for them. The demo is on Exercises now, where it explains the thing beside it.
 *
 * Presentational: what is true of the gym today comes in as props, and is left out while there is
 * nothing to say, since a first screen with zeroes on it reads as a place nobody uses.
 */
export function FirstScreen({ testnet, leader, cheapest, agents, runs, gigs }: FirstScreenProps) {
  return (
    <div className="home">
      <section className="intro">
        <p className="kicker"><span>//</span> <FormattedMessage id="home.kicker" /></p>
        <h1 className="headline"><FormattedMessage id="home.headline" /></h1>
        <p className="sub"><FormattedMessage id="home.sub" /></p>
        <div className="ctas">
          <a className="btn primary" href={PATHS.fund}><FormattedMessage id="home.ctaSetUp" /></a>
          <a className="btn secondary" href={viewHref("standings")}><FormattedMessage id="home.ctaStandings" /></a>
        </div>
        <p className="fine"><FormattedMessage id="home.fine" values={{ testnet: String(testnet) }} /></p>
      </section>

      <section className="how" aria-labelledby="how-title">
        <h2 id="how-title" className="give-label"><FormattedMessage id="home.how" /></h2>
        <ol className="how-steps">
          {HOW.map((step, i) => (
            <li key={step.title}>
              <span className="step-n" aria-hidden="true">{i + 1}</span>
              <div>
                <h3><FormattedMessage id={step.title} /></h3>
                <p><FormattedMessage id={step.detail} /></p>
              </div>
            </li>
          ))}
        </ol>
        {(leader !== null || gigs !== null) && (
          <dl className="facts">
            {/* Paid work is the reason to earn rep, so when some is open it is said first. */}
            {gigs !== null && (
              <div>
                <dt><FormattedMessage id="home.gigs" /></dt>
                <dd>
                  <a href={viewHref("gigs")}>
                    <FormattedMessage id="frame.gigsOpen" values={{ count: gigs.count, amount: <Amount value={gigs.onOffer} /> }} />
                  </a>
                </dd>
              </div>
            )}
            {leader !== null && <div>
              <dt><FormattedMessage id="home.leading" /></dt>
              <dd>
                <FormattedMessage id="home.leadingValue" values={{
                  id: leader.identity, rep: leader.rep,
                  link: (chunks) => <a href={viewHref("standings")}>{chunks}</a>,
                }} />
              </dd>
            </div>}
            {cheapest !== null && (
              <div>
                <dt><FormattedMessage id="home.cheapest" /></dt>
                <dd><FormattedMessage id="home.cheapestValue" values={{ exercise: cheapest.title, amount: <Amount value={cheapest.spend} /> }} /></dd>
              </div>
            )}
            {leader !== null && <div>
              <dt><FormattedMessage id="home.onRecord" /></dt>
              <dd><FormattedMessage id="home.onRecordValue" values={{ agents, runs }} /></dd>
            </div>}
          </dl>
        )}
      </section>
    </div>
  );
}
