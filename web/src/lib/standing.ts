import type { FundsWire, Standing } from "../../../src/wire.ts";

/**
 * How a balance reads, decided once.
 *
 * The page this replaces decided it twice — in a server template and again in a browser script —
 * with the bare strings "good", "bad" and "wait", and nothing checking that the two agreed.
 */
export function standingOf(funds: FundsWire | undefined): Standing {
  if (!funds) return "unknown";
  return funds.ready ? "ready" : "short";
}
