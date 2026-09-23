import { useBounties, useFeed } from "../api/useGym.ts";
import { Plate } from "../plate/Plate.tsx";
import { Nav } from "../plate/Nav.tsx";
import { useView } from "../plate/useView.ts";
import { Hero } from "../hero/Hero.tsx";
import { Gigs } from "./Gigs.tsx";
import { Ledger } from "./Ledger.tsx";
import { Amount } from "../components/Amount.tsx";
import { chainFor, type ArcChainId } from "../chain/arc.ts";

export interface HomeProps {
  readonly chainId: ArcChainId;
  readonly probePrice: string;
}

const sum = (xs: readonly string[]) => xs.reduce((t, x) => t + Number(x), 0).toFixed(6);

/**
 * The rig.
 *
 * What an agent's owner wants is for it to earn. The gym is how it earns the right to: training runs
 * build a record, and enough record makes the agent eligible for gigs that pay real money. So the
 * page leads with the payoff and shows the training as the way to it — not the other way round,
 * which is how it read when it opened on "every question costs money".
 */
export function Home({ chainId, probePrice }: HomeProps) {
  const view = useView();
  const bounties = useBounties();
  const feed = useFeed();
  const chain = chainFor(chainId);

  const open = (bounties.data ?? []).filter((b) => b.open);
  const onOffer = sum(open.map((b) => b.amount));
  const runs = feed.data ?? [];

  return (
    <Plate
      top={{
        start: <span className="brand">BENCH<b>//</b></span>,
        end: <Nav current={view} />,
      }}
      left={<>ARC {chain.testnet ? "TESTNET" : "MAINNET"} · CHAIN {chain.id}</>}
      right={<>{open.length} GIGS OPEN · <Amount value={onOffer} /> ON OFFER</>}
      bottom={{
        start: <>{runs.length} RUNS LOGGED</>,
        middle: <span className="loop-line">TRAIN&nbsp;&nbsp;→&nbsp;&nbsp;REP&nbsp;&nbsp;→&nbsp;&nbsp;GIGS&nbsp;&nbsp;→&nbsp;&nbsp;PAID</span>,
        end: <>x402 · USDC</>,
      }}
    >
      {view === "rig" && (
        <div className="home">
          <section className="intro">
            <p className="kicker"><span>//</span> a gym for agents</p>
            <h1 className="headline">Gigs pay.<br /><em>Rep</em> gets you in.</h1>
            <p className="sub">
              Your agent trains here to build a record. Enough record, and it can take bounties that pay
              real money, posted by people who need the work done.
            </p>
            <div className="ctas">
              <a className="btn primary" href="/fund">Load your agent</a>
              <a className="btn" href="/#gigs">See the gigs</a>
            </div>
            {open.length > 0 && (
              <a className="gig-teaser" href="/#gigs">
                <span className="gig-count">{open.length}</span>
                <span className="gig-label">
                  gigs open now<br /><Amount value={onOffer} /> on offer
                </span>
              </a>
            )}
          </section>
          <Hero probePrice={probePrice} />
        </div>
      )}
      {view === "gigs" && <Gigs bounties={bounties.data ?? []} />}
      {view === "ledger" && <Ledger runs={runs} />}
    </Plate>
  );
}
