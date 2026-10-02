const MINUTE = 60, HOUR = 3_600, DAY = 86_400;

/** How long ago, in the roughest unit that is still true. */
export function since(when: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - when) / 1000));
  if (seconds < MINUTE) return `${seconds}s ago`;
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m ago`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h ago`;
  return `${Math.floor(seconds / DAY)}d ago`;
}

/** How long is left, or that there is none. */
export function until(deadline: number, now = Date.now()): string {
  const ms = deadline - now;
  if (ms <= 0) return "closed";
  const days = Math.floor(ms / (DAY * 1000));
  if (days >= 1) return `${days}d left`;
  const hours = Math.floor(ms / (HOUR * 1000));
  return hours >= 1 ? `${hours}h left` : "under an hour left";
}

/** An address is long and its ends are what identify it. The middle is noise on a page. */
export const short = (address: string | null): string =>
  !address ? "none" : address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
