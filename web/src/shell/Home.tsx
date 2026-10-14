import { FormattedMessage } from "react-intl";
import { useEffect } from "react";
import { useBounties, useFeed, useOwner, useProblems, useStandings } from "../shared/api/useGym.ts";
import { Plate } from "./Plate.tsx";
import { Nav } from "./Nav.tsx";
import { Masthead } from "./Masthead.tsx";
import { FirstScreen } from "./FirstScreen.tsx";
import { useRoute, viewHref } from "./useView.ts";
import { Hero } from "../train/demo/Hero.tsx";
import { Gigs } from "../gigs/Gigs.tsx";
import { Standings } from "../rep/Standings.tsx";
import { Yours } from "../yours/Yours.tsx";
import { CONNECTED_VIEW, isWallet, useOwnerWallet } from "../shared/lib/ownerWallet.ts";
import { Exercise } from "../train/Exercise.tsx";
import { ExerciseList } from "../train/ExerciseList.tsx";
import { ExerciseRail } from "../train/ExerciseRail.tsx";
import { byLevel } from "../train/order.ts";
import { Amount } from "../shared/components/Amount.tsx";
import { format, usdc } from "../../../src/shared/money.ts";
import { useNetwork } from "../shared/network/NetworkProvider.tsx";

export interface HomeProps {
  readonly probePrice: string;
}

/** The exercise with a demo of its own, and the word in the address that asks for it. */
const DEMO = "blackbox";
const DEMO_DETAIL = "demo";

const sum = (xs: readonly string[]) => format(xs.reduce((t, x) => t + usdc(x), 0n));

/**
 * The first screen, My agent, Exercises, Standings and Gigs, in one frame.
 *
 * The pages are set out for the person whose agent it is. Somebody new is told what the place is
 * for and sent to Start. Somebody whose wallet is connected opens on their own agent, because how it
 * is doing is what they came back for. The rest answer, in turn: what is it tested on, who is
 * ahead, and what pays.
 */
export function Home({ probePrice }: HomeProps) {
  const { view, detail } = useRoute();
  const { chain, testnet } = useNetwork();
  const wallet = useOwnerWallet();
  const { returned: answered, owner } = wallet;
  const mine = useOwner(owner);

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

  /**
   * An owner opening the gym lands on their own agent. Only at the bare address: `#home` is asked
   * for by name, by the brand's link, so the first screen is still theirs to read.
   */
  const landing = view === "home" && owner !== null && window.location.hash === "";
  useEffect(() => {
    if (landing) window.location.replace(viewHref("yours", owner));
  }, [landing, owner]);

  const problems = useProblems();
  const list = byLevel(problems.data ?? []);
  const asked = detail[0];
  const chosen = asked !== undefined && list.some((p) => p.id === asked) ? asked : null;
  const showDemo = chosen === DEMO && detail[1] === DEMO_DETAIL;
  const demoHref = viewHref("exercises", DEMO, DEMO_DETAIL);
  const bounties = useBounties();
  const feed = useFeed();
  const standings = useStandings();

  const open = (bounties.data ?? []).filter((b) => b.open);
  const onOffer = sum(open.map((b) => b.amount));
  const runs = feed.data ?? [];
  const table = standings.data;
  const best = table?.best ?? [];
  /** The identities the connected wallet's agents carry, so what is theirs can be marked as theirs. */
  const myIdentities = (mine.data?.agents ?? []).flatMap((a) => (a.identity === null ? [] : [a.identity]));
  const cheapest = best.reduce<(typeof best)[number] | null>(
    (least, b) => (least === null || usdc(b.spend) < usdc(least.spend) ? b : least), null);

  return (
    <Plate
      top={{
        start: <Masthead home={viewHref("home")} />,
        end: <Nav current={view} wallet={wallet} />,
      }}
      left={<FormattedMessage id="frame.network" values={{ testnet: String(testnet), id: chain.id }} />}
      right={<FormattedMessage id="frame.gigsOpen" values={{ count: open.length, amount: <Amount value={onOffer} /> }} />}
      bottom={{
        start: <FormattedMessage id="frame.runsLogged" values={{ count: runs.length }} />,
        end: <FormattedMessage id="frame.money" values={{ testnet: String(testnet) }} />,
      }}
    >
      {view === "home" && !landing && (
        <FirstScreen
          leader={table?.agents[0] ?? null}
          cheapest={cheapest === null ? null
            : { title: list.find((p) => p.id === cheapest.problem)?.title ?? cheapest.problem, spend: cheapest.spend }}
          agents={(table?.agents.length ?? 0) + (table?.more ?? 0)}
          runs={(table?.agents ?? []).reduce((total, a) => total + a.runs, 0)}
          gigs={open.length === 0 ? null : { count: open.length, onOffer }}
          prices={list[0]?.prices ?? null}
        />
      )}
      {/* Not until the gym has said what its exercises are: "0 puzzles" over an empty box is a claim about the gym. */}
      {view === "exercises" && chosen === null && (problems.data
        ? <ExerciseList problems={list} best={best} mine={myIdentities} demoHref={demoHref} />
        : <p className={problems.isError ? "state bad" : "state idle"}>
            <FormattedMessage id={problems.isError ? "exercises.failed" : "exercises.reading"} />
          </p>
      )}
      {/* One exercise: the rest a tap away along the rail, and under it its rules and everyone who has solved it, or its demo. */}
      {view === "exercises" && chosen !== null && (
        <section className="train">
          <ExerciseRail problems={list} chosen={chosen} />
          {showDemo
            ? <Hero probePrice={probePrice} />
            : <Exercise id={chosen} demoHref={chosen === DEMO ? demoHref : null} />}
        </section>
      )}
      {view === "yours" && <Yours wallet={(detail[0] ?? "").trim()} connected={owner} connect={wallet.connect} onConnect={wallet.beginConnect}
                                  connectHref={wallet.connectHref} gym={window.location.origin} />}
      {view === "standings" && <Standings table={table} failed={standings.isError} problems={list} mine={myIdentities}
                                          runs={runs} looking={detail[0] ?? ""} />}
      {view === "gigs" && <Gigs bounties={bounties.data ?? []} mine={mine.data} />}
    </Plate>
  );
}
