import { useMemo, type ComponentType } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  bisectSample, blackBoxSample, codebreakerSample, liarSample, rankingSample, SAMPLE_SEED, tollSample, zendoSample,
} from "./sample.ts";
import { usePlayback } from "./usePlayback.ts";
import { TollSample, tollSteps } from "./TollSample.tsx";
import { BisectSample, bisectSteps } from "./BisectSample.tsx";
import { ZendoSample, zendoSteps } from "./ZendoSample.tsx";
import { CodebreakerSample, codebreakerSteps } from "./CodebreakerSample.tsx";
import { RankingSample, rankingSteps } from "./RankingSample.tsx";
import { BlackBoxSample, blackBoxSteps } from "./BlackBoxSample.tsx";
import { LiarSample, liarSteps } from "./LiarSample.tsx";

/**
 * The pace of each drawing, per step. A cell of a maze is a short step; a question asked and
 * answered is a long one, long enough to read the answer before the next arrives.
 */
const MS_PER_CELL = 220;
const MS_PER_QUESTION = 1_100;
const MS_PER_BAR = 450;

interface Played { readonly label: string }

// Each one builds its instance once, since Zendo builds its whole list of rules to find the hidden one.
function Toll({ label }: Played) {
  const s = useMemo(() => tollSample(), []);
  return <TollSample sample={s} label={label} step={usePlayback(tollSteps(s), MS_PER_CELL)} />;
}
function Bisect({ label }: Played) {
  const s = useMemo(() => bisectSample(), []);
  return <BisectSample sample={s} label={label} step={usePlayback(bisectSteps(s), MS_PER_QUESTION)} />;
}
function Zendo({ label }: Played) {
  const s = useMemo(() => zendoSample(), []);
  return <ZendoSample sample={s} label={label} step={usePlayback(zendoSteps(s), MS_PER_QUESTION)} />;
}
function Codebreaker({ label }: Played) {
  const s = useMemo(() => codebreakerSample(), []);
  return <CodebreakerSample sample={s} label={label} step={usePlayback(codebreakerSteps(s), MS_PER_QUESTION)} />;
}
function Ranking({ label }: Played) {
  const s = useMemo(() => rankingSample(), []);
  return <RankingSample sample={s} label={label} step={usePlayback(rankingSteps(s), MS_PER_BAR)} />;
}
function BlackBox({ label }: Played) {
  const s = useMemo(() => blackBoxSample(), []);
  return <BlackBoxSample sample={s} label={label} step={usePlayback(blackBoxSteps(s), MS_PER_QUESTION)} />;
}
function Liar({ label }: Played) {
  const s = useMemo(() => liarSample(), []);
  return <LiarSample sample={s} label={label} step={usePlayback(liarSteps(s), MS_PER_BAR)} />;
}

interface Drawing {
  /** What the drawing shows, in words: its caption, and what a screen reader hears for it. */
  readonly caption: "sample.toll" | "sample.bisect" | "sample.zendo" | "sample.codebreaker" | "sample.ranking" | "sample.blackbox" | "sample.liar";
  readonly Play: ComponentType<Played>;
}

/** Each exercise's drawing, by the exercise's id. */
const DRAWINGS: Readonly<Record<string, Drawing>> = {
  toll: { caption: "sample.toll", Play: Toll },
  bisect: { caption: "sample.bisect", Play: Bisect },
  zendo: { caption: "sample.zendo", Play: Zendo },
  codebreaker: { caption: "sample.codebreaker", Play: Codebreaker },
  ranking: { caption: "sample.ranking", Play: Ranking },
  blackbox: { caption: "sample.blackbox", Play: BlackBox },
  liar: { caption: "sample.liar", Play: Liar },
};

/**
 * One instance of the exercise, played out, so a person sees what the agent is up against and how it
 * gets to the answer.
 *
 * It is the real thing: the gym's own generator, given a seed no run is ever played on, and each step
 * the gym's own answer. In a run the agent sees none of it until it pays; here it plays step by step,
 * holds the answer, and starts again. An exercise with no drawing shows nothing rather than a picture
 * that is not its own.
 */
export function ExerciseSample({ id }: { readonly id: string }) {
  const intl = useIntl();
  const entry = DRAWINGS[id];
  if (!entry) return null;
  const { Play } = entry;
  return (
    <figure className="ex-sample">
      <figcaption>
        <span className="cap"><FormattedMessage id="sample.kicker" /></span>
        <span>{intl.formatMessage({ id: entry.caption })}</span>
      </figcaption>
      <Play label={intl.formatMessage({ id: entry.caption })} />
      <p className="ex-sample-note"><FormattedMessage id="sample.note" values={{ seed: SAMPLE_SEED }} /></p>
    </figure>
  );
}
