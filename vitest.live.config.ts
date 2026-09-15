import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: { enabled: false },
    fileParallelism: false,
    globals: true,
    include: ["tests/live/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
