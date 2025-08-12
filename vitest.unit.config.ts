import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [
      "node_modules/**",
      "dist/**",
      "src/__tests__/integration/**",
      "src/__tests__/e2e/**",
    ],
  },
});
