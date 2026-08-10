import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The gate lives in worker/, outside vitest's default src/ include. These are pure
    // functions, so no Workers runtime is needed to test them.
    include: ["worker/**/*.test.ts", "src/**/*.test.ts"],
  },
});
