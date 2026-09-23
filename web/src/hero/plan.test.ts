import { describe, expect, test } from "vitest";
import { planBoard, foundAfter, RAYS_PER_BOARD } from "./plan.ts";
import { fire } from "../../../src/problems/blackbox.ts";

const PRICE = 20_000;
const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

describe("a planned board", () => {
  test("is the same every time for the same seed", () => {
    expect(planBoard(42, PRICE)).toEqual(planBoard(42, PRICE));
  });

  test("never shows a ray the game would not produce", () => {
    for (const seed of SEEDS) {
      const plan = planBoard(seed, PRICE);
      for (const ray of plan.rays) expect(ray.trace.result).toEqual(fire(plan.board, ray.port));
    }
  });

  test("never fires the same port twice", () => {
    for (const seed of SEEDS) {
      const plan = planBoard(seed, PRICE);
      const fired = plan.rays.map((r) => `${r.port.side}:${r.port.index}`);
      expect(new Set(fired).size).toBe(fired.length);
    }
  });

  test("stays inside its budget", () => {
    for (const seed of SEEDS) {
      const plan = planBoard(seed, PRICE);
      expect(plan.rays.filter((r) => !r.refused).length).toBeLessThanOrEqual(RAYS_PER_BOARD);
    }
  });

  test("a solved board has found every atom, and was never refused", () => {
    for (const seed of SEEDS) {
      const plan = planBoard(seed, PRICE);
      if (!plan.solved) continue;
      expect(foundAfter(plan, plan.rays.length)).toHaveLength(plan.board.atoms.length);
      expect(plan.rays.some((r) => r.refused)).toBe(false);
    }
  });

  test("an unsolved board ends on exactly one refusal, and it is the last ray", () => {
    for (const seed of SEEDS) {
      const plan = planBoard(seed, PRICE);
      if (plan.solved) continue;
      const refused = plan.rays.filter((r) => r.refused);
      expect(refused).toHaveLength(1);
      expect(plan.rays[plan.rays.length - 1]!.refused).toBe(true);
    }
  });

  test("a refused ray is cut short, not drawn to the end", () => {
    for (const seed of SEEDS) {
      for (const ray of planBoard(seed, PRICE).rays) {
        if (ray.refused) { expect(ray.stopsAt).toBeGreaterThan(0); expect(ray.stopsAt).toBeLessThan(1); }
        else expect(ray.stopsAt).toBe(1);
      }
    }
  });

  test("the refused ray is not charged", () => {
    for (const seed of SEEDS) {
      const plan = planBoard(seed, PRICE);
      expect(plan.spent).toBe(plan.rays.filter((r) => !r.refused).length * PRICE);
    }
  });

  /** Both endings have to appear across a session, or the front page only ever tells half the story. */
  test("some boards solve and some are refused", () => {
    const plans = SEEDS.map((s) => planBoard(s, PRICE));
    const solved = plans.filter((p) => p.solved).length;
    expect(solved).toBeGreaterThan(SEEDS.length * 0.25);
    expect(solved).toBeLessThan(SEEDS.length * 0.9);
  });
});
