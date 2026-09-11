import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The client paces outbound requests (see packages/client/src/guard.ts).
    // Real pacing would add minutes to the suite, so tests run unpaced. The
    // pacing logic itself is covered directly in guard.test.ts with an
    // injected clock, so zeroing it here loses no coverage.
    setupFiles: ["./vitest.setup.ts"],
  },
});
