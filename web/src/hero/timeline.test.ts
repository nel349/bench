import { describe, expect, test } from "vitest";
import { planBoard } from "./plan.ts";
import { frameAt, lengthOf, priceOpacity, schedule } from "./timeline.ts";

const PRICE = 20_000;
const SEEDS = Array.from({ length: 120 }, (_, i) => i + 1);

/** Samples a run densely enough to catch a frame that jumps. */
const sample = (seed: number, every = 16) => {
  const plan = planBoard(seed, PRICE);
  const frames = [];
  for (let t = 0; t <= lengthOf(plan); t += every) frames.push({ t, frame: frameAt(plan, t) });
  return { plan, frames };
};

describe("the board's timeline", () => {
  test("nothing is drawn before the first ray is bought", () => {
    const f = frameAt(planBoard(7, PRICE), 0);
    expect(f.trails).toHaveLength(0);
    expect(f.active).toBe(null);
    expect(f.found).toHaveLength(0);
    expect(f.bought).toBe(0);
  });

  test("rays are bought one at a time, never overlapping", () => {
    for (const seed of SEEDS) {
      const slots = schedule(planBoard(seed, PRICE));
      for (let i = 1; i < slots.length; i++) {
        expect(slots[i]!.start).toBeGreaterThanOrEqual(slots[i - 1]!.start + slots[i - 1]!.travel);
      }
    }
  });

  /** A spend that dropped on some frame would read as money coming back. */
  test("what has been spent never goes down while the board is up", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      let before = 0;
      for (const { frame } of sample(seed).frames) {
        expect(frame.bought).toBeGreaterThanOrEqual(before);
        before = frame.bought;
      }
    }
  });

  test("an atom, once found, stays found", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      let before = 0;
      for (const { frame } of sample(seed).frames) {
        expect(frame.found.length).toBeGreaterThanOrEqual(before);
        before = frame.found.length;
      }
    }
  });

  test("the head of a ray never leaves the path it is on", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      for (const { frame } of sample(seed).frames) {
        if (!frame.active) continue;
        const { head } = frame.active;
        const path = frame.active.ray.trace.path;
        const onSegment = path.some((a, i) => {
          const b = path[i + 1];
          if (!b) return a.x === head.x && a.y === head.y;
          const inX = Math.min(a.x, b.x) - 1e-9 <= head.x && head.x <= Math.max(a.x, b.x) + 1e-9;
          const inY = Math.min(a.y, b.y) - 1e-9 <= head.y && head.y <= Math.max(a.y, b.y) + 1e-9;
          return inX && inY;
        });
        expect(onSegment).toBe(true);
      }
    }
  });

  /**
   * The refusal is the product's whole argument, so it has to be on screen when the board ends —
   * stopped where the money ran out, in red, and never quietly promoted to a finished trail.
   */
  test("a refused board ends with the refused ray halted, not landed", () => {
    for (const seed of SEEDS) {
      const plan = planBoard(seed, PRICE);
      if (plan.solved) continue;
      const slots = schedule(plan);
      const last = slots[slots.length - 1]!;
      const f = frameAt(plan, last.start + last.travel + 10);
      expect(f.ending).toBe("refused");
      expect(f.active?.halted).toBe(true);
      expect(f.active?.ray.refused).toBe(true);
      expect(f.trails.some((r) => r.refused)).toBe(false);
    }
  });

  test("a solved board ends solved, with every atom found and nothing in flight", () => {
    for (const seed of SEEDS) {
      const plan = planBoard(seed, PRICE);
      if (!plan.solved) continue;
      const slots = schedule(plan);
      const last = slots[slots.length - 1]!;
      const f = frameAt(plan, last.start + last.travel + 10);
      expect(f.ending).toBe("solved");
      expect(f.active).toBe(null);
      expect(f.found).toHaveLength(plan.board.atoms.length);
    }
  });

  test("the refused ray is never counted as bought", () => {
    for (const seed of SEEDS) {
      const plan = planBoard(seed, PRICE);
      const f = frameAt(plan, lengthOf(plan) - 1);
      expect(f.bought).toBe(plan.rays.filter((r) => !r.refused).length);
    }
  });

  test("the board fades out, and is over only once it has", () => {
    const plan = planBoard(3, PRICE);
    const end = lengthOf(plan);
    expect(frameAt(plan, end - 1).done).toBe(false);
    expect(frameAt(plan, end).done).toBe(true);
    expect(frameAt(plan, end).opacity).toBe(0);
    expect(frameAt(plan, 0).opacity).toBe(1);
  });
});

/**
 * The price label is the one number that explains what is being watched. It used to fade from the
 * moment it appeared, so on a short probe it was never fully readable.
 */
describe("the price label", () => {
  test("is held at full strength for most of its life", () => {
    const held = Array.from({ length: 1000 }, (_, i) => i / 1000).filter((l) => priceOpacity(l) === 1);
    expect(held.length / 1000).toBeGreaterThan(0.55);
  });

  test("arrives quickly rather than flashing in", () => {
    expect(priceOpacity(0.02)).toBeGreaterThan(0);
    expect(priceOpacity(0.1)).toBe(1);
  });

  test("is gone at the end of its life and invisible before it starts", () => {
    expect(priceOpacity(0)).toBe(0);
    expect(priceOpacity(1)).toBe(0);
  });

  test("never exceeds full strength or goes negative", () => {
    for (let i = 0; i <= 1000; i++) {
      const o = priceOpacity(i / 1000);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
    }
  });
});

/** The narration is what makes the picture make sense, so it has to be right about what happened. */
describe("the narration", () => {
  test("says nothing before the first probe lands", () => {
    expect(frameAt(planBoard(5, PRICE), 0).narration).toBe(null);
  });

  test("describes the probe that just landed, by its real outcome", () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const plan = planBoard(seed, PRICE);
      const slots = schedule(plan);
      plan.rays.forEach((ray, i) => {
        const slot = slots[i]!;
        const n = frameAt(plan, slot.start + slot.travel + 5).narration!;
        expect(n.n).toBe(i + 1);
        if (ray.refused) expect(n.tone).toBe("refused");
        else if (ray.trace.result.kind === "hit") { expect(n.tone).toBe("found"); expect(n.what).toMatch(/atom is hiding here/i); }
        else expect(n.tone).toBe("miss");
      });
    }
  });

  test("names the side a probe was fired from", () => {
    const plan = planBoard(11, PRICE);
    const slot = schedule(plan)[0]!;
    const n = frameAt(plan, slot.start + slot.travel + 5).narration!;
    const side = { up: "the top", down: "the bottom", left: "the left", right: "the right" }[plan.rays[0]!.port.side];
    expect(n.from).toBe(side);
  });

  test("a refused probe says why, in money", () => {
    for (const seed of SEEDS) {
      const plan = planBoard(seed, PRICE);
      if (plan.solved) continue;
      const f = frameAt(plan, lengthOf(plan) - 1);
      expect(f.narration?.what).toMatch(/out of money/i);
      break;
    }
  });
});
