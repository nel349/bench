/**
 * USDC, as an integer count of micros.
 *
 * Money is never a float here. A price of $0.05 is 50_000 micros, and every sum is exact. The
 * temptation is to use a number because the amounts are small — and small amounts summed a thousand
 * times is exactly where a float starts disagreeing with a ledger.
 */
export type Usdc = bigint;

export const MICROS = 1_000_000n;

/** From a decimal string, which is how prices are written down and how a 402 quotes them. */
export function usdc(amount: string): Usdc {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(amount.trim());
  if (!m) throw new Error(`not an amount: ${amount}`);
  return BigInt(m[1]!) * MICROS + BigInt((m[2] ?? "").padEnd(6, "0"));
}

/** Back to a string, always six places, because a ledger that rounds for display invites disputes. */
export function format(v: Usdc): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  return `${neg ? "-" : ""}${abs / MICROS}.${(abs % MICROS).toString().padStart(6, "0")}`;
}

/** What a person reads: two places, rounded down, never used for arithmetic. */
export function display(v: Usdc): string {
  return `$${format(v).replace(/(\.\d{2})\d+$/, "$1")}`;
}
