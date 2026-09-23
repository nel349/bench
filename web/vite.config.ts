/** `vitest/config` rather than `vite`, so the test block is typed rather than ignored. */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { DEFAULT_PORT, PATHS, WEB_DEV_PORT } from "../src/paths.ts";

/**
 * The page is a real application, built, not a string.
 *
 * It used to be an HTML template on the server plus two hundred lines of browser JavaScript inside
 * template literals — which `tsc` never saw, no test ever ran, and no tool ever checked. A typo in
 * a DOM call surfaced when somebody clicked.
 *
 * `/api` proxies to the gym in development so the app talks to a real server rather than a fixture.
 */
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: true },
  /**
   * The front page draws the real Black Box rules, imported from the server's source rather than
   * copied — a copy is a second implementation, and the picture could then disagree with the game.
   * That module is pure, with no imports, so nothing server-side follows it into the bundle.
   */
  resolve: { alias: {} },
  server: {
    port: WEB_DEV_PORT,
    strictPort: true,
    fs: { allow: [".."] },
    /**
     * Every API route, proxied to the gym — built from the router's own route table.
     *
     * It was seven hand-written entries that had already drifted: `/settings`, which the app fetches
     * before it renders anything, was not among them, so development showed a blank page.
     */
    proxy: Object.fromEntries(
      Object.values(PATHS)
        .filter((path) => path !== "/")
        .map((path) => [path, `http://localhost:${process.env["PORT"] ?? DEFAULT_PORT}`]),
    ),
  },
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test-setup.ts"] },
});
