import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

// Needs a reachable Postgres. DATABASE_URL is read from .env the same way the
// app reads it, so `npm run test:integration` works against whatever database
// you already develop against.
const env = loadEnv("", process.cwd(), "");

export default defineConfig({
  test: {
    environment: "node",
    env,
    include: ["app/**/*.integration.test.ts"],
    // These share fixture rows, so never run the files against one database
    // concurrently.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
