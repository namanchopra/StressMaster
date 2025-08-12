import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Default test configuration
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
