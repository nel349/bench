/**
 * The same gym on the other Arc network, named so the page can offer a way across.
 *
 * Each network has a gym of its own: its own process, its own records and its own money. Test money
 * and real money never share one. What joins them is a link, and this is where it is read from.
 * Only the origin is kept, because the page adds the path of whatever it is showing.
 *
 * A name that is not an address stops the gym from starting. Served as written, it would be a
 * switch on every page that goes nowhere.
 */
export const OTHER_GYM_ENV = "BENCH_OTHER_GYM";

export function otherGymFrom(raw: string | undefined): string | null {
  const named = raw?.trim();
  if (!named) return null;
  let url: URL;
  try {
    url = new URL(named);
  } catch {
    throw new Error(`${OTHER_GYM_ENV} is not an address: ${named}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${OTHER_GYM_ENV} must be an http or https address: ${named}`);
  }
  return url.origin;
}
