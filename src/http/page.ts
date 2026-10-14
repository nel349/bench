
import { PATHS } from "../shared/paths.ts";

/** Whether this request is a person navigating, rather than a client fetching. */
export const wantsHtml = (req: Request): boolean =>
  (req.headers.get("accept") ?? "").includes("text/html");
/**
 * The paths that are pages of the app in their own right, as opposed to a view inside one.
 *
 * Whoever asks for one of these gets the page, a browser or not. Start's link is printed on the
 * site and handed to agents, and a client that did not say it wanted HTML was told "no route" for
 * an address that plainly exists.
 */
export const isPagePath = (path: string): boolean => PAGE_PATHS.includes(path);
const PAGE_PATHS: readonly string[] = [PATHS.fund];

/** Where `bun run build` puts the browser app. */
export const APP_DIR = new URL("../../web/dist/", import.meta.url);
/**
 * A file from the built app, or the page itself for anything that is not one.
 *
 * Paths are resolved against the build directory and checked to still be inside it, because a
 * request for `/../.env` is a request somebody makes on purpose.
 */
export async function servedFile(path: string, navigating: boolean): Promise<Response | null> {
  const wanted = new URL(`.${path}`, APP_DIR);
  if (!wanted.pathname.startsWith(APP_DIR.pathname)) return null;

  const asset = Bun.file(wanted);
  if (path !== "/" && await asset.exists()) {
    return new Response(asset, {
      headers: {
        "content-type": asset.type,
        // Vite fingerprints assets, so they can be cached hard. The page itself cannot.
        ...(path.startsWith("/assets/") ? { "cache-control": "public, max-age=31536000, immutable" } : {}),
      },
    });
  }

  /**
   * A missing asset is a 404, never the page.
   *
   * Falling through would answer a request for a script with HTML, and the browser reports that as
   * a MIME type error somewhere else entirely — a deploy that dropped one file would look like a
   * bug in the application.
   */
  if (path.startsWith("/assets/")) return null;

  /**
   * Only a browser gets the page.
   *
   * A deep link must survive a reload, so an unknown path renders the app and lets it decide. But
   * an agent that typos an API path is asking for JSON, and answering it with HTML turns a typo
   * into a parse error somewhere unrelated — it gets the 404 it asked for.
   */
  if (!navigating) return null;

  const index = Bun.file(new URL("index.html", APP_DIR));
  if (!await index.exists()) return null;
  return new Response(index, { headers: { "content-type": "text/html; charset=utf-8" } });
}
