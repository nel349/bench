/**
 * Money, for reading.
 *
 * The wire carries six decimal places because a ledger that rounds invites disputes. A person
 * reads two. These are the only two places that difference is allowed to exist.
 */
export const forReading = (decimal: string): string => decimal.replace(/(\.\d{2})\d+$/, "$1");

export const asDollars = (decimal: string): string => `$${forReading(decimal)}`;
