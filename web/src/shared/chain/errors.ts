/** EIP-1193: the code a wallet returns when the person declined. Being turned down is not a fault. */
export const USER_REJECTED = 4001;

/**
 * Whether the person said no, as opposed to something going wrong.
 *
 * Wallets are inconsistent: some return the code, some only a message, and some nest both inside a
 * `cause`. Treating a refusal as a failure tells somebody their money is stuck when they simply
 * changed their mind.
 */
export function wasDeclined(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (e.code === USER_REJECTED) return true;
    if (typeof e.message === "string" && /user rejected|user denied|declined/i.test(e.message)) return true;
    current = e.cause;
  }
  return false;
}
