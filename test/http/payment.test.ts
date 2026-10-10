import { describe, expect, test } from "bun:test";
import { describes } from "../../src/http/payment.ts";
import { PATHS } from "../../src/shared/paths.ts";

/** A buyer's wallet may show what was bought beside the payment; recording a solve read "One probe". */
describe("what a payment says it buys", () => {
  test("each paid route names its own purchase", () => {
    expect(describes(`${PATHS.attempts}/a1/ask`).description).toBe("One question");
    expect(describes(`${PATHS.attempts}/a1/submit`).description).toBe("A graded answer");
    expect(describes(`${PATHS.attempts}/a1/rank`).description).toMatch(/^Recording a solve/);
    expect(describes(`${PATHS.bounties}/b1/solve`).description).toBe("An answer to a gig");
  });

  test("the URL stays relative, and the shape is what the facilitator requires", () => {
    expect(describes(`${PATHS.attempts}/a1/ask`)).toEqual({
      url: "/attempts/a1/ask", description: "One question", mimeType: "application/json",
    });
  });
});
