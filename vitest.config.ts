import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Backend only. src/front-end is a separate package with its own Vite
    // config; running its tests from here would use the wrong environment.
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "src/front-end/**"],
    // Node, not jsdom — nothing under test touches a DOM yet. The scraper
    // tests will need jsdom when the page.evaluate callbacks are extracted.
    environment: "node",
    env: {
      // The scoring function logs once per player. Silence it so a failure is
      // the only thing in the output.
      LOG_LEVEL: "silent",
    },
  },
});
