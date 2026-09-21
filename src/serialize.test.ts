import { expect, test, describe } from "bun:test";
import { Serial } from "./serialize.ts";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("one thing at a time, per key", () => {
  test("work on one key never overlaps", async () => {
    const s = new Serial();
    let running = 0, maxRunning = 0;
    await Promise.all([1, 2, 3, 4, 5].map(() => s.run("a", async () => {
      running++; maxRunning = Math.max(maxRunning, running);
      await tick(5);
      running--;
    })));
    expect(maxRunning).toBe(1);
  });

  test("and runs in the order it was queued", async () => {
    const s = new Serial();
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((n) => s.run("a", async () => { await tick(6 - n); order.push(n); })));
    expect(order).toEqual([1, 2, 3]);
  });

  test("different keys do not wait for each other", async () => {
    const s = new Serial();
    const started = performance.now();
    await Promise.all(["a", "b", "c"].map((k) => s.run(k, () => tick(20))));
    expect(performance.now() - started).toBeLessThan(55); // not 60+, which is serial
  });

  test("the value comes back to the caller", async () => {
    const s = new Serial();
    expect(await s.run("a", async () => 42)).toBe(42);
  });

  /** A task that throws must not wedge every later task on that key. */
  test("a failure does not break the queue behind it", async () => {
    const s = new Serial();
    const boom = s.run("a", async () => { throw new Error("boom"); });
    await expect(boom).rejects.toThrow("boom");
    expect(await s.run("a", async () => "after")).toBe("after");
  });

  test("a rejection is delivered to its own caller and nobody else", async () => {
    const s = new Serial();
    const bad = s.run("a", async () => { throw new Error("mine"); });
    const good = s.run("a", async () => "fine");
    await expect(bad).rejects.toThrow("mine");
    expect(await good).toBe("fine");
  });

  test("keys are dropped when idle, so the map does not grow forever", async () => {
    const s = new Serial();
    await Promise.all(Array.from({ length: 50 }, (_, i) => s.run(`k${i}`, async () => i)));
    await tick(5);
    expect(s.size).toBe(0);
  });

  test("a key stays while work is still queued on it", async () => {
    const s = new Serial();
    const held = s.run("a", () => tick(20));
    expect(s.size).toBe(1);
    await held;
    await tick(5);
    expect(s.size).toBe(0);
  });
});
