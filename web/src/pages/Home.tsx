import { useBounties, useFeed, useOwner, useProblems } from "../api/useGym.ts";
import { Plate } from "../plate/Plate.tsx";
import { Nav } from "../plate/Nav.tsx";
import { useRoute, viewHref } from "../plate/useView.ts";
import { Hero } from "../hero/Hero.tsx";
import { Gigs } from "./Gigs.tsx";
import { Ledger } from "./Ledger.tsx";
import { Yours } from "./Yours.tsx";
import { CONNECTED_VIEW, isWallet, useOwnerWallet } from "../lib/ownerWallet.ts";
import { useEffect } from "react";
import { Exercise } from "./Exercise.tsx";
import { ExerciseRail } from "../components/ExerciseRail.tsx";
import { Amount } from "../components/Amount.tsx";
import { chainFor, type ArcChainId } from "../chain/arc.ts";
import { PATHS } from "../../../src/paths.ts";

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
 * The rig.
 *
 * What an agent's owner wants is for it to earn. The gym is how it earns the right to: training runs
 * build a record, and enough record makes the agent eligible for gigs that pay real money. So the
 * page leads with the payoff and shows the training as the way to it — not the other way round,
 * which is how it read when it opened on "every question costs money".
 */
export function Home({ chainId, probePrice, registry, walletUrl }: HomeProps) {
  const { view, detail } = useRoute();
  const wallet = useOwnerWallet(walletUrl);
  const { remember } = wallet;
  const mine = useOwner(wallet.owner);

  // Back from the wallet's Connect: keep the address and open its page, or, cancelled, the front page.
  const returned = view === CONNECTED_VIEW ? detail[0] ?? "" : null;
  useEffect(() => {
    if (returned === null) return;
    if (isWallet(returned)) {
      remember(returned);
      window.location.replace(viewHref("yours", returned));
    } else {
      window.location.replace(viewHref("rig"));
    }
  }, [returned, remember]);
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
        start: <span className="brand">BENCH<b>//</b></span>,
        end: <Nav current={view} wallet={wallet} />,
      }}
      left={<>ARC {chain.testnet ? "TESTNET" : "MAINNET"} · CHAIN {chain.id}</>}
      right={<>{open.length} {open.length === 1 ? "GIG" : "GIGS"} OPEN · <Amount value={onOffer} /> ON OFFER</>}
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
              <a className="btn primary" href={PATHS.fund}>Load your agent</a>
              <a className="btn" href={viewHref("gigs")}>See the gigs</a>
            </div>
            {open.length > 0 && (
              <a className="gig-teaser" href={viewHref("gigs")}>
                <span className="gig-count">{open.length}</span>
                <span className="gig-label">
                  {open.length === 1 ? "gig" : "gigs"} open now<br /><Amount value={onOffer} /> on offer
                </span>
              </a>
            )}
          </section>
          <div className="stage">
            {list.length > 0 && <ExerciseRail problems={list} chosen={chosen} />}
            {showDemo
              ? <Hero probePrice={probePrice} />
              : <Exercise id={chosen} number={list.findIndex((p) => p.id === chosen) + 1}
                          demoHref={chosen === DEMO ? viewHref("rig", DEMO) : null} />}
          </div>
        </div>
      )}
      {view === "yours" && <Yours wallet={detail[0] ?? ""} remember={remember} connectHref={wallet.connectHref}
                                  explorer={chain.blockExplorers.default.url} />}
      {view === "gigs" && <Gigs bounties={bounties.data ?? []} explorer={chain.blockExplorers.default.url} mine={mine.data} />}
      {view === "ledger" && <Ledger runs={runs} looking={detail[0] ?? ""} registry={registry}
                                    explorer={chain.blockExplorers.default.url} />}
    </Plate>
  );
}
