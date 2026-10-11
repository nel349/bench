import { FormattedMessage } from "react-intl";
import { useBounties, useFeed, useOwner, useProblems } from "../shared/api/useGym.ts";
import { Plate } from "./Plate.tsx";
import { Nav } from "./Nav.tsx";
import { useRoute, viewHref } from "./useView.ts";
import { Hero } from "../train/demo/Hero.tsx";
import { Gigs } from "../gigs/Gigs.tsx";
import { Rep } from "../rep/Rep.tsx";
import { Yours } from "../yours/Yours.tsx";
import { CONNECTED_VIEW, isWallet, useOwnerWallet } from "../shared/lib/ownerWallet.ts";
import { useEffect } from "react";
import { Exercise } from "../train/Exercise.tsx";
import { ExerciseRail } from "../train/ExerciseRail.tsx";
import { Amount } from "../shared/components/Amount.tsx";
import { chainFor, type ArcChainId } from "../shared/chain/arc.ts";
import { PATHS } from "../../../src/shared/paths.ts";

export interface HomeProps {
  readonly chainId: ArcChainId;
  readonly probePrice: string;
  /** The reputation registry, for the rep lookup to point at. `null` where the server has none. */
  readonly registry: string | null;
  /** The owner's wallet app, for Connect wallet. `null` where none serves this network. */
  readonly walletUrl: string | null;
}

/** The exercise with a demo of its own. The rest show their card and board. */
const DEMO = "blackbox";

const sum = (xs: readonly string[]) => xs.reduce((t, x) => t + Number(x), 0).toFixed(6);

/**
 * The front page, Train, Rep, Gigs and Your agents, in one frame.
 *
 * What an agent's owner wants is for it to earn. The gym is how it earns the right to: training runs
 * build a record, and enough record makes the agent eligible for gigs that pay real money. So the
 * page leads with the payoff and shows the training as the way to it — not the other way round,
 * which is how it read when it opened on "every question costs money".
 */
export function Home({ chainId, probePrice, registry, walletUrl }: HomeProps) {
  const { view, detail } = useRoute();
  const wallet = useOwnerWallet(walletUrl);
  const { returned: answered } = wallet;
  const mine = useOwner(wallet.owner);

  // Back from the wallet's Connect: keep the address and open its page, or, cancelled, the front page.
  // The wallet hook decides what it is the answer to: it replaces a connected wallet only when
  // Connect wallet was pressed here, so a link of this shape cannot swap one or undo a Disconnect;
  // and it is told of an empty answer too, which ends the asking.
  const returned = view === CONNECTED_VIEW ? detail[0] ?? "" : null;
  useEffect(() => {
    if (returned === null) return;
    const address = returned.trim();
    answered(address);
    if (isWallet(address)) {
      window.location.replace(viewHref("yours", address));
    } else {
      window.location.replace(viewHref("home"));
    }
  }, [returned, answered]);
  const problems = useProblems();
  const list = problems.data ?? [];
  const asked = detail[0];
  const chosen = asked !== undefined && list.some((p) => p.id === asked) ? asked : DEMO;
  const showDemo = chosen === DEMO && detail[1] !== "board";
  const bounties = useBounties();
  const feed = useFeed();
  const chain = chainFor(chainId);

  const open = (bounties.data ?? []).filter((b) => b.open);
  const onOffer = sum(open.map((b) => b.amount));
  const runs = feed.data ?? [];

  return (
    <Plate
      top={{
        start: <a className="brand" href={viewHref("home")}>BENCH<b>//</b></a>,
        end: <Nav current={view} wallet={wallet} />,
      }}
      left={<FormattedMessage id="frame.network" values={{ testnet: String(chain.testnet === true), id: chain.id }} />}
      right={<FormattedMessage id="frame.gigsOpen" values={{ count: open.length, amount: <Amount value={onOffer} /> }} />}
      bottom={{
        start: <FormattedMessage id="frame.runsLogged" values={{ count: runs.length }} />,
        middle: <span className="loop-line"><FormattedMessage id="frame.loop" /></span>,
        end: <FormattedMessage id="frame.money" values={{ testnet: String(chain.testnet === true) }} />,
      }}
    >
      {/* The front page: what Bench is, the way in, and one picture of it. The exercises are Train's. */}
      {view === "home" && (
        <div className="home">
          <section className="intro">
            <p className="kicker"><span>//</span> <FormattedMessage id="home.kicker" /></p>
            <h1 className="headline"><FormattedMessage id="home.headline1" /><br /><FormattedMessage id="home.headline2" /></h1>
            <p className="sub"><FormattedMessage id="home.sub" /></p>
            <div className="ctas">
              <a className="btn primary" href={PATHS.fund}><FormattedMessage id="home.ctaSetUp" /></a>
              <a className="btn secondary" href={viewHref("gigs")}><FormattedMessage id="home.ctaGigs" /></a>
            </div>
            {open.length > 0 && (
              <a className="gig-teaser" href={viewHref("gigs")}>
                <span className="gig-count">{open.length}</span>
                <span className="gig-label">
                  <FormattedMessage id="home.teaser" values={{ count: open.length }} /><br />
                  <FormattedMessage id="home.teaserOffer" values={{ amount: <Amount value={onOffer} /> }} />
                </span>
              </a>
            )}
          </section>
          <div className="stage">
            <Hero probePrice={probePrice} numbered={false} />
          </div>
        </div>
      )}
      {view === "rig" && (
        <section className="train">
          <p className="kicker"><span>01</span> <FormattedMessage id="train.kicker" /></p>
          {list.length > 0 && <ExerciseRail problems={list} chosen={chosen} />}
          {showDemo
            ? <Hero probePrice={probePrice} />
            : <Exercise id={chosen} number={list.findIndex((p) => p.id === chosen) + 1}
                        demoHref={chosen === DEMO ? viewHref("rig", DEMO) : null} />}
        </section>
      )}
      {view === "yours" && <Yours wallet={(detail[0] ?? "").trim()} offer={wallet.offer} connect={wallet.connect} onConnect={wallet.beginConnect}
                                  connectHref={wallet.connectHref}
                                  explorer={chain.blockExplorers.default.url} />}
      {view === "gigs" && <Gigs bounties={bounties.data ?? []} explorer={chain.blockExplorers.default.url} mine={mine.data} />}
      {view === "ledger" && <Rep runs={runs} titleOf={(id) => list.find((p) => p.id === id)?.title ?? id}
                                 looking={detail[0] ?? ""} registry={registry}
                                 explorer={chain.blockExplorers.default.url} />}
    </Plate>
  );
}
