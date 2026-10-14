import { afterEach, describe, expect, test, vi } from "vitest";
import { screen } from "@testing-library/react";
import { render } from "../strings.tsx";
import {
  bisectSample, blackBoxSample, codebreakerSample, liarSample, rankingSample, SAMPLE_SEED, tollSample, zendoSample,
} from "../../src/train/sample/sample.ts";
import { ExerciseSample } from "../../src/train/sample/ExerciseSample.tsx";
import { EXIT, mazeFrom, shortestRoute, START, walk } from "../../../src/problems/toll.ts";
import { historyFrom, KNOWN_BAD, KNOWN_GOOD, test as testCommit } from "../../../src/problems/bisect.ts";
import { ruleFor } from "../../../src/problems/zendo.ts";
import { codeFrom, score } from "../../../src/problems/codebreaker.ts";
import { orderFrom } from "../../../src/problems/ranking.ts";
import { boardFrom } from "../../../src/problems/blackbox-rules.ts";
import { LIE_WINDOW, secretFrom } from "../../../src/problems/liar.ts";

/** Every exercise the gym has, by id. A drawing missing for one of them is a page without its picture. */
const EXERCISES = ["toll", "bisect", "zendo", "codebreaker", "ranking", "blackbox", "liar"] as const;

describe("each sample is the gym's own instance for the sample seed", () => {
  test("Toll: the drawn route is the shortest one, walks the maze, and runs from the start to the exit", () => {
    const s = tollSample();
    const route = shortestRoute(mazeFrom(SAMPLE_SEED));
    expect(s.steps).toBe(route.length);
    expect(walk(s.maze, route)).toBe(true);
    expect(s.path[0]).toEqual(START);
    expect(s.path[s.path.length - 1]).toEqual(EXIT);
    // Each step of the path moves one cell, through no wall.
    for (let i = 1; i < s.path.length; i++) {
      const a = s.path[i - 1]!, b = s.path[i]!;
      expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1);
    }
  });

  test("Bisect: the first bad commit is the history's, and the marked runs are exactly the commits that will not build", () => {
    const s = bisectSample();
    const h = historyFrom(SAMPLE_SEED);
    expect(s.firstBad).toBe(h.firstBad);
    const marked = s.broken.flatMap((r) => Array.from({ length: r.to - r.from + 1 }, (_, i) => r.from + i));
    expect(new Set(marked)).toEqual(h.broken);
    expect(s.brokenCount).toBe(h.broken.size);
    for (const c of marked) expect(testCommit(h, c)).toBe("untestable");
  });

  test("Bisect: the search's every test is the gym's own verdict, and it closes on the first bad commit", () => {
    const s = bisectSample();
    const h = historyFrom(SAMPLE_SEED);
    for (const p of s.probes) expect(p.verdict).toBe(testCommit(h, p.commit));
    const good = Math.max(KNOWN_GOOD, ...s.probes.filter((p) => p.verdict === "good").map((p) => p.commit));
    const bad = Math.min(KNOWN_BAD, ...s.probes.filter((p) => p.verdict === "bad").map((p) => p.commit));
    expect(good).toBe(s.firstBad - 1);
    expect(bad).toBe(s.firstBad);
  });

  test("Zendo: the rule is the hidden one, and every answer shown is the one the rule gives", () => {
    const s = zendoSample();
    const rule = ruleFor(SAMPLE_SEED);
    expect(s.rule).toBe(rule.name);
    expect(s.asked.filter((a) => a.holds)).toHaveLength(3);
    expect(s.asked.filter((a) => !a.holds)).toHaveLength(3);
    for (const a of s.asked) expect(rule.holds(a.triple)).toBe(a.holds);
  });

  test("Codebreaker: the code is the hidden one, and each guess is scored by the gym's own rule", () => {
    const s = codebreakerSample();
    expect(s.code).toBe(codeFrom(SAMPLE_SEED));
    for (const g of s.guesses) expect(g.score).toEqual(score(s.code, g.guess));
  });

  test("Ranking: the order is the hidden one, and the question's answer is whichever of the two it ranks higher", () => {
    const s = rankingSample();
    const order = orderFrom(SAMPLE_SEED);
    expect(s.order).toBe(order);
    const { a, b, better } = s.asked;
    expect(better).toBe(order.indexOf(a) < order.indexOf(b) ? a : b);
  });

  test("Black Box: the atoms are the board's, and there is one ray of each kind, the one leaving elsewhere visibly turning", () => {
    const s = blackBoxSample();
    expect(s.board).toEqual(boardFrom(SAMPLE_SEED));
    expect(s.rays.map((r) => r.result.kind)).toEqual(["hit", "reflect", "detour"]);
    const out = s.rays[2]!;
    expect(new Set(out.path.map((c) => c.x)).size).toBeGreaterThan(1);
    expect(new Set(out.path.map((c) => c.y)).size).toBeGreaterThan(1);
  });

  test("Liar: the number and the lie are the secret's, the lie counted from one", () => {
    const s = liarSample();
    const secret = secretFrom(SAMPLE_SEED);
    expect(s.number).toBe(secret.number);
    expect(s.lie).toBe(secret.lieAt + 1);
    expect(s.window).toBe(LIE_WINDOW);
  });
});

/** A browser asked for less motion, which shows each drawing finished. */
const stillMotion = () => vi.stubGlobal("matchMedia", (query: string) => ({
  matches: query === "(prefers-reduced-motion: reduce)", media: query,
  addEventListener: () => undefined, removeEventListener: () => undefined,
}));

afterEach(() => { vi.unstubAllGlobals(); });

describe("an exercise page's sample", () => {
  test.each(EXERCISES)("%s is drawn, with a caption that names what it shows and the seed it came from", (id) => {
    render(<ExerciseSample id={id} />);
    const figure = screen.getByRole("figure");
    expect(figure.querySelector("figcaption")).toHaveTextContent("Example");
    expect(screen.getByRole("img")).toHaveAccessibleName();
    expect(figure).toHaveTextContent(`"${SAMPLE_SEED}"`);
  });

  test("an exercise with no drawing shows nothing, rather than a picture that is not its own", () => {
    const { container } = render(<ExerciseSample id="unknown" />);
    expect(container).toBeEmptyDOMElement();
  });

  test("asked for less motion, Toll shows its whole route and Liar every answer, its lie alone in red", () => {
    stillMotion();
    render(<ExerciseSample id="toll" />);
    const points = document.querySelector("polyline.route")!.getAttribute("points")!.split(" ");
    expect(points).toHaveLength(tollSample().path.length);
    render(<ExerciseSample id="liar" />);
    expect(document.querySelectorAll(".liar .lie")).toHaveLength(1);
    expect(document.querySelectorAll(".liar .answer")).toHaveLength(LIE_WINDOW - 1);
  });
});

describe("a sample played out", () => {
  test("starts with nothing found: Toll at its start, Zendo's rule and Codebreaker's code hidden, Black Box's atoms dark", () => {
    render(<ExerciseSample id="toll" />);
    expect(document.querySelector("polyline.route")!.getAttribute("points")!.split(" ")).toHaveLength(1);
    render(<ExerciseSample id="zendo" />);
    expect(document.querySelector(".zendo .rule")).toHaveTextContent("Hidden rule");
    render(<ExerciseSample id="codebreaker" />);
    expect(document.querySelectorAll(".codebreaker .code .peg.hidden")).toHaveLength(4);
    render(<ExerciseSample id="blackbox" />);
    expect(document.querySelectorAll(".blackbox .atom")).toHaveLength(0);
  });

  test("finished, each shows what it found: the rule named, the code shown, the atoms lit", () => {
    stillMotion();
    render(<ExerciseSample id="zendo" />);
    expect(document.querySelector(".zendo .rule")).toHaveTextContent(zendoSample().rule);
    render(<ExerciseSample id="codebreaker" />);
    expect(document.querySelectorAll(".codebreaker .code .peg.hidden")).toHaveLength(0);
    render(<ExerciseSample id="blackbox" />);
    expect(document.querySelectorAll(".blackbox .atom")).toHaveLength(blackBoxSample().board.atoms.length);
    render(<ExerciseSample id="bisect" />);
    expect(document.querySelector(".bisect .mark")).toHaveTextContent(String(bisectSample().firstBad));
  });
});
