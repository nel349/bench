/**
 * What a par run costs: par probes at the probe price, as a decimal string like every amount here.
 *
 * Shown beside par so "par 16" also reads as "$0.32", which is the number a visitor compares a run
 * against. `null` where no par is proven, rather than a guess.
 */
export function parCost(par: number | null, probePrice: string): string | null {
  if (par === null) return null;
  const micros = BigInt(Math.round(Number(probePrice) * 1_000_000)) * BigInt(par);
  return `${micros / 1_000_000n}.${(micros % 1_000_000n).toString().padStart(6, "0")}`;
}

/** A count of probes in words: "1 probe", "14 probes". */
export const probes = (n: number): string => `${n} probe${n === 1 ? "" : "s"}`;
