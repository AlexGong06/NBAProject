import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Backend, plus the front end's data layer.
    //
    // src/front-end is otherwise a separate package with its own Vite config,
    // and its components are not tested from here. The fixture is the
    // exception: it hand-copies the backend's scoring formula, so the two have
    // to be comparable in one process to assert they still agree. Everything
    // under src/front-end/src/data is plain TypeScript with no DOM or
    // import.meta, so it loads fine in this environment.
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "src/front-end/src/components/**"],
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
