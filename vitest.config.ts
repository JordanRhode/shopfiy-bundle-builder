import { defineConfig } from "vitest/config";

// Deliberately does not reuse vite.config.ts: that one loads the Remix plugin,
// which expects a full app build and is not needed to exercise plain modules.
export default defineConfig({
  test: {
    environment: "node",
    // Unit tests only. The database-backed suite is opt-in via
    // `npm run test:integration`, so `npm test` stays green without Postgres.
    include: ["app/**/*.test.ts"],
    exclude: ["app/**/*.integration.test.ts", "node_modules/**", "build/**"],
  },
});
