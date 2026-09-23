import type { Cell } from "../../../src/problems/blackbox.ts";
import { foundAfter, type BoardPlan, type PlannedRay } from "./plan.ts";
import {
  MS_BETWEEN_RAYS, MS_FADE, MS_HOLD_FINISHED, MS_PER_CELL, MS_PRICE_VISIBLE,
  PRICE_FADE_IN, PRICE_HOLD_UNTIL,
} from "./timing.ts";

/**
 * What to draw at a given moment of a board's run.
 *
 * Pure: a plan and a time in, a frame out. The component that renders it knows nothing about when
 * rays start or how far they have got, and this knows nothing about SVG — which is what lets the
 * one thing that can be wrong about the animation be tested without a browser.
 */

export interface ActiveRay {
  readonly ray: PlannedRay;
  /** The path so far, ending at the head, which may sit between two cells. */
  readonly drawn: readonly Cell[];
  readonly head: Cell;
  /** Whether it has reached the point it was stopped at. A refused ray lingers there in red. */
  readonly halted: boolean;
}

export interface Price {
  readonly at: Cell;
  /** Which side of the board it was bought from, so the label can sit outward, clear of the board. */
  readonly side: "up" | "down" | "left" | "right";
  readonly age: number;
  readonly refused: boolean;
  /**
   * Arrives quickly, is held at full strength for most of its life, then leaves. Computed here and
   * not in the component, so "is the price ever fully readable" is a test rather than a hope.
   */
  readonly opacity: number;
  /** How far outward from the port it has drifted, in cells. */
  readonly reach: number;
}

/** The price label's envelope over its life, from 0 to 1. */
export function priceOpacity(life: number): number {
  if (life <= 0 || life >= 1) return 0;
  if (life < PRICE_FADE_IN) return life / PRICE_FADE_IN;
  if (life <= PRICE_HOLD_UNTIL) return 1;
  return 1 - (life - PRICE_HOLD_UNTIL) / (1 - PRICE_HOLD_UNTIL);
}

/**
 * What the last probe did, in words.
 *
 * The picture alone does not make sense to somebody who has never seen the game: a line bends and
 * nothing says why, and nothing says there is anything hidden to find. So each probe is narrated as
 * it lands, in the plain terms of the rule it just demonstrated — which teaches the game by watching
 * it, rather than by a paragraph nobody reads first.
 */
export interface Narration {
  readonly n: number;
  readonly from: string;
  readonly what: string;
  readonly tone: "found" | "miss" | "refused";
}

const SIDE_WORDS = { up: "the top", down: "the bottom", left: "the left", right: "the right" } as const;

function narrate(ray: PlannedRay, n: number): Narration {
  const from = SIDE_WORDS[ray.port.side];
  if (ray.refused) return { n, from, what: "Blocked. Out of money, so nothing comes back.", tone: "refused" };
  const r = ray.trace.result;
  if (r.kind === "hit") return { n, from, what: "Absorbed. An atom is hiding here.", tone: "found" };
  if (r.kind === "reflect") return { n, from, what: "Came straight back. An atom sits close to where it went in.", tone: "miss" };
  return { n, from, what: `Bent by an atom, it came out at ${SIDE_WORDS[r.exit.side]}.`, tone: "miss" };
}

export interface Frame {
  /** Rays already landed, drawn as the faint web the board accumulates. */
  readonly trails: readonly PlannedRay[];
  readonly active: ActiveRay | null;
  readonly found: readonly Cell[];
  readonly prices: readonly Price[];
  /** How many rays have been paid for so far. */
  readonly bought: number;
  /** 1 while the board is showing, falling to 0 as it fades. */
  readonly opacity: number;
  /** Once the last ray has landed, how the board ended. */
  readonly ending: "solved" | "refused" | null;
  readonly done: boolean;
  /** The most recent probe to land, or be stopped, in words. Null before the first one. */
  readonly narration: Narration | null;
}

interface Slot { readonly start: number; readonly travel: number }

/** How long a ray is in flight: its length in cells, or the part of it a refusal allows. */
const travelOf = (ray: PlannedRay): number =>
  Math.max(1, (ray.trace.path.length - 1) * ray.stopsAt) * MS_PER_CELL;

export function schedule(plan: BoardPlan): readonly Slot[] {
  const slots: Slot[] = [];
  let at = MS_BETWEEN_RAYS;
  for (const ray of plan.rays) {
    const travel = travelOf(ray);
    slots.push({ start: at, travel });
    at += travel + MS_BETWEEN_RAYS;
  }
  return slots;
}

/** When the whole board is over, fade included. */
export function lengthOf(plan: BoardPlan): number {
  const slots = schedule(plan);
  const last = slots[slots.length - 1];
  const landed = last ? last.start + last.travel : 0;
  return landed + MS_HOLD_FINISHED + MS_FADE;
}

/** A point `fraction` of the way along a path of unit steps. */
function along(path: readonly Cell[], fraction: number): { drawn: Cell[]; head: Cell } {
  const segments = path.length - 1;
  if (segments <= 0) return { drawn: [path[0]!], head: path[0]! };

  const distance = Math.min(segments, Math.max(0, fraction * segments));
  const whole = Math.floor(distance);
  const part = distance - whole;
  const from = path[whole]!;
  const to = path[Math.min(whole + 1, segments)]!;
  const head = { x: from.x + (to.x - from.x) * part, y: from.y + (to.y - from.y) * part };
  return { drawn: [...path.slice(0, whole + 1), head], head };
}

export function frameAt(plan: BoardPlan, t: number): Frame {
  const slots = schedule(plan);
  const trails: PlannedRay[] = [];
  const prices: Price[] = [];
  let active: ActiveRay | null = null;
  let landed = 0;

  plan.rays.forEach((ray, i) => {
    const slot = slots[i]!;
    const since = t - slot.start;
    if (since < 0) return;

    if (since < MS_PRICE_VISIBLE) {
      const life = since / MS_PRICE_VISIBLE;
      prices.push({
        at: ray.trace.path[0]!, side: ray.port.side, age: since, refused: ray.refused,
        opacity: priceOpacity(life), reach: 0.5 + life * 0.18,
      });
    }

    if (since >= slot.travel) {
      landed = i + 1;
      // A refused ray never lands as a trail. It stays where it was stopped, in red, as the ending.
      if (ray.refused) {
        const { drawn, head } = along(ray.trace.path, ray.stopsAt);
        active = { ray, drawn, head, halted: true };
      } else {
        trails.push(ray);
      }
      return;
    }

    const { drawn, head } = along(ray.trace.path, (since / slot.travel) * ray.stopsAt);
    active = { ray, drawn, head, halted: false };
  });

  const last = slots[slots.length - 1];
  const finishedAt = last ? last.start + last.travel : 0;
  const fadeFrom = finishedAt + MS_HOLD_FINISHED;
  const opacity = t < fadeFrom ? 1 : Math.max(0, 1 - (t - fadeFrom) / MS_FADE);
  const over = landed === plan.rays.length && plan.rays.length > 0;

  const lastLanded = landed > 0 ? plan.rays[landed - 1] : undefined;

  return {
    trails,
    active,
    narration: lastLanded ? narrate(lastLanded, landed) : null,
    found: foundAfter(plan, landed),
    prices,
    bought: plan.rays.slice(0, landed).filter((r) => !r.refused).length,
    opacity,
    ending: over ? (plan.solved ? "solved" : "refused") : null,
    done: t >= lengthOf(plan),
  };
}
