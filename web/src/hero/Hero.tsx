import { useEffect, useMemo, useState } from "react";
import { planBoard, RAYS_PER_BOARD } from "./plan.ts";
import { frameAt, lengthOf } from "./timeline.ts";
import { useClock, usePrefersReducedMotion } from "./useClock.ts";
import { BlackBoxField } from "./BlackBoxField.tsx";
import { Readout } from "./Readout.tsx";
import { forReading } from "../lib/money.ts";

export interface HeroProps {
  /** The price of one ray, as the wire carries it. */
  readonly probePrice: string;
}

/** A sentence does not start with a numeral. */
const WORDS: Readonly<Record<number, string>> = { 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six" };

/** A fresh board each visit, so the front page is not the same film every time. */
const firstSeed = () => (Math.floor(Date.now() / 1000) % 9_000) + 1;

/**
 * One exact frame, on request: `?board=42&at=8000` draws board 42 at eight seconds and holds it.
 *
 * The animation is driven by the browser's frame clock, which stops dead in a hidden tab — so a
 * screenshot taken from outside the page races a moving target, and in the background catches none.
 * A still frame named in the URL is the same every time, which is what makes the picture something
 * that can be checked, and what lets somebody share a specific moment of a specific board.
 */
function stillFrameRequested(): { readonly board: number | null; readonly at: number | null } {
  const q = new URLSearchParams(window.location.search);
  const num = (v: string | null) => (v !== null && /^\d+$/.test(v) ? Number(v) : null);
  return { board: num(q.get("board")), at: num(q.get("at")) };
}

/**
 * The front page's one image: an agent paying to see into a Black Box, board after board.
 *
 * It is the product in miniature and the product's own first problem, played by its real rules.
 * Rays are bought one at a time, each at the price the gym actually charges; the board fills with
 * the light of what was paid for; and it ends either solved for an amount or refused at one.
 */
export function Hero({ probePrice }: HeroProps) {
  const price = Math.round(Number(probePrice) * 1_000_000);
  const reduced = usePrefersReducedMotion();
  const [still] = useState(stillFrameRequested);
  const [seed, setSeed] = useState(() => still.board ?? firstSeed());
  const plan = useMemo(() => planBoard(seed, price), [seed, price]);
  const holding = still.at !== null || reduced;
  const elapsed = useClock(seed, !holding);

  // A still frame if one was asked for; a finished board if motion is reduced; otherwise the film.
  const t = still.at ?? (reduced ? lengthOf(plan) - 2_000 : elapsed);
  const frame = frameAt(plan, t);

  useEffect(() => {
    if (!holding && frame.done) setSeed((s) => s + 1);
  }, [frame.done, holding]);

  const cost = `$${forReading(probePrice)}`;
  const n = frame.narration;

  return (
    <section className="exhibit" aria-label="A demonstration of the Black Box exercise">
      {/*
        * What this is, said before anything moves. Without it the animation was a tilted grid with
        * lines on it — and worse, its panel read like a real agent's live run, which it is not.
        */}
      <header className="exhibit-head">
        <div className="ex-line">
          <span className="ex-no">Exercise 01</span>
          <span className="demo-tag">Demo · simulated agent</span>
          <a className="ex-switch" href="#rig/blackbox/board">See its board</a>
        </div>
        <h2 className="ex-name">Black Box</h2>
        <p className="ex-rule">
          {WORDS[plan.board.atoms.length] ?? plan.board.atoms.length} atoms are hidden in the grid and the agent can't see them. It fires
          probes in from the edges, <b>{cost} each</b>, and works out where the atoms are from how
          each probe comes back.
        </p>
      </header>

      <div className="rig">
        <BlackBoxField size={plan.board.size} frame={frame} price={cost} />
        <Readout seed={seed} frame={frame} atoms={plan.board.atoms.length}
                 budget={RAYS_PER_BOARD} price={price} />
      </div>

      <p className={`narration ${n?.tone ?? "idle"}`} aria-live="polite">
        {n ? <><span className="probe-no">Probe {n.n}</span> from {n.from}. {n.what}</>
           : <>Watching the agent pick its first probe…</>}
      </p>

      <ul className="legend" aria-label="Key">
        <li><i className="k-probe" />probe</li>
        <li><i className="k-atom" />atom found</li>
        <li><i className="k-ice" />out of money</li>
      </ul>
    </section>
  );
}
