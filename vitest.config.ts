import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: { enabled: false },
    exclude: [...configDefaults.exclude, "tests/live/**/*.test.ts"],
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
