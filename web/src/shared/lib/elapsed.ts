import { phrase, type Phrase } from "./phrase.ts";

const MINUTE = 60, HOUR = 3_600, DAY = 86_400;

/** How long ago, in the roughest unit that is still true. */
export function since(when: number, now = Date.now()): Phrase {
  const seconds = Math.max(0, Math.round((now - when) / 1000));
  if (seconds < MINUTE) return phrase("time.secondsAgo", { n: seconds });
  if (seconds < HOUR) return phrase("time.minutesAgo", { n: Math.floor(seconds / MINUTE) });
  if (seconds < DAY) return phrase("time.hoursAgo", { n: Math.floor(seconds / HOUR) });
  return phrase("time.daysAgo", { n: Math.floor(seconds / DAY) });
}

/** How long is left, or that there is none. */
export function until(deadline: number, now = Date.now()): Phrase {
  const ms = deadline - now;
  if (ms <= 0) return phrase("time.closed");
  const days = Math.floor(ms / (DAY * 1000));
  if (days >= 1) return phrase("time.daysLeft", { n: days });
  const hours = Math.floor(ms / (HOUR * 1000));
  return hours >= 1 ? phrase("time.hoursLeft", { n: hours }) : phrase("time.underAnHour");
}

/** An address is long and its ends are what identify it. The middle is noise on a page. */
export const short = (address: string): string =>
  address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
