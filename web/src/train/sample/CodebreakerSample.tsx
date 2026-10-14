import { LENGTH } from "../../../../src/problems/codebreaker.ts";
import type { CodebreakerSample as Codebreaker } from "./sample.ts";

/** A peg, its letter written on it so the colours are never the only way to tell them apart. */
function Peg({ colour }: { readonly colour: string | null }) {
  return colour === null ? <span className="peg hidden">?</span> : <span className={`peg c-${colour}`}>{colour}</span>;
}

/** How many steps Codebreaker's drawing takes: one per guess, then the code shown. */
export const codebreakerSteps = (s: Codebreaker) => s.guesses.length + 1;

/** Codebreaker's guesses, one at a time with how close each came, and the hidden code shown at the end. */
export function CodebreakerSample({ sample, label, step }: { readonly sample: Codebreaker; readonly label: string; readonly step: number }) {
  const shown = step > sample.guesses.length;
  return (
    <div className="sample-draw codebreaker" role="img" aria-label={label}>
      <div className="row code">{[...sample.code].map((c, i) => <Peg key={i} colour={shown ? c : null} />)}</div>
      {sample.guesses.map(({ guess, score }, g) => (
        <div key={guess} className={g < step ? "row" : "row pending"}>
          {[...guess].map((c, i) => <Peg key={i} colour={c} />)}
          <span className="score">
            {Array.from({ length: LENGTH }, (_, i) => (
              <i key={i} className={i < score.exact ? "exact" : i < score.exact + score.near ? "near" : "miss"} />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
