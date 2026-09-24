import type { Hex } from "viem";

/**
 * Reads a private key the gym signs with, from the environment variable it came from.
 *
 * Validated at startup rather than at the point of use, so a malformed key stops the process before
 * it serves anything, instead of at the moment somebody wins a bounty or ranks a run, which is the
 * worst time to find out. The message names the variable and never repeats the value.
 */
export function privateKeyFrom(variable: string, raw: string | undefined): Hex | null {
  if (!raw) return null;
  const key = raw.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(`${variable} must be a 0x-prefixed 32-byte hex private key`);
  }
  return key as Hex;
}
