import { Explained } from "../shared/components/Explained.tsx";
import { FormattedMessage } from "react-intl";
import type { MessageId } from "../strings/StringsProvider.tsx";
import type { StandingWire } from "../../../src/shared/wire.ts";
import { Amount } from "../shared/components/Amount.tsx";
import { viewHref } from "./useView.ts";
import { PATHS } from "../../../src/shared/paths.ts";
import { useNetwork } from "../shared/network/NetworkProvider.tsx";

export interface FirstScreenProps {
  /** The agent ahead of the rest, or `null` while none has recorded a solve. */
  readonly leader: Pick<StandingWire, "identity" | "rep"> | null;
  /** The cheapest record there is, and the exercise it is on. `null` while there is none. */
  readonly cheapest: { readonly title: string; readonly spend: string } | null;
  /** How many agents have recorded a solve, and the runs they have paid for between them. */
  readonly agents: number;
  readonly runs: number;
  /** The gigs open now and what they pay between them. `null` while none is open. */
  readonly gigs: { readonly count: number; readonly onOffer: string } | null;
  /** What a question and a record cost here. `null` until the gym has said. */
  readonly prices: { readonly ask: string; readonly rank: string } | null;
}

interface Step { readonly title: MessageId; readonly detail: MessageId }

/** How an agent comes by its money: an allowance from the owner's wallet, or, where no wallet serves the network, a balance of its own. */
const GIVE_ALLOWANCE: Step = { title: "home.how1.title", detail: "home.how1.detail" };
const GIVE_BALANCE: Step = { title: "home.how1Own.title", detail: "home.how1Own.detail" };

/** What an owner does after that. With the first step it makes three things, and the agent does the rest. */
const THEN: readonly Step[] = [
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
 * What is true of the gym today comes in as props, and is left out while there is nothing to say,
 * since a first screen with zeroes on it reads as a place nobody uses. Which network this is comes
 * from the network context.
 */
export function FirstScreen({ leader, cheapest, agents, runs, gigs, prices }: FirstScreenProps) {
  const { testnet, walletUrl, other } = useNetwork();
  /**
   * Where the guided setup does not run but this gym names the network where it does, the first
   * screen sends a newcomer there: the main button, and the steps, which are that network's and say
   * so. What can be done here is one line under them. It used to promise five minutes and open a
   * form only a developer could fill in.
   */
  const across = walletUrl === null && other !== null ? other : null;
  const how = [walletUrl !== null || across !== null ? GIVE_ALLOWANCE : GIVE_BALANCE, ...THEN];
  return (
    <div className="home">
      <section className="intro">
        <p className="kicker"><span>//</span> <FormattedMessage id="home.kicker" /></p>
        <h1 className="headline"><FormattedMessage id="home.headline" /></h1>
        <Explained about="home.about" head={<p className="sub"><FormattedMessage id="home.lead" /></p>}>
          <p><FormattedMessage id="home.sub" /></p>
        </Explained>
        <div className="ctas">
          {across === null
            ? <a className="btn primary" href={PATHS.fund}><FormattedMessage id="home.ctaSetUp" /></a>
            : <a className="btn primary" href={`${across}${PATHS.fund}`}><FormattedMessage id="home.ctaAcross" /></a>}
          <a className="btn secondary" href={viewHref("standings")}><FormattedMessage id="home.ctaStandings" /></a>
        </div>
        <p className="fine">
          {across === null
            ? <FormattedMessage id="home.fine" values={{ testnet: String(testnet) }} />
            : <FormattedMessage id="home.fineAcross" />}
        </p>
      </section>

      <section className="how" aria-labelledby="how-title">
        {/* The three titles say it; what each means, and what it costs, are behind the "?". */}
        <Explained about="home.aboutHow" head={
          <h2 id="how-title" className="give-label"><FormattedMessage id={across === null ? "home.how" : "home.howAcross"} /></h2>
        }>
          {how.map((step, i) => (
            <p key={step.title}><b>{i + 1}.</b> <FormattedMessage id={step.detail} /></p>
          ))}
          {/* Both prices: "a few cents" over a record of $0.02 hid that being recorded is a quarter. */}
          {prices !== null && (
            <p><FormattedMessage id="home.costs" values={{ ask: <Amount value={prices.ask} />, record: <Amount value={prices.rank} /> }} /></p>
          )}
        </Explained>
        <ol className="how-steps">
          {how.map((step, i) => (
            <li key={step.title}>
              <span className="step-n" aria-hidden="true">{i + 1}</span>
              <div>
                <h3><FormattedMessage id={step.title} /></h3>
              </div>
            </li>
          ))}
        </ol>
        {across !== null && (
          <p className="how-here">
            <FormattedMessage id="home.ownHere" values={{ link: (chunks) => <a href={PATHS.fund}>{chunks}</a> }} />
          </p>
        )}
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
                  link: (chunks) => <a href={viewHref("standings", leader.identity)}>{chunks}</a>,
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
