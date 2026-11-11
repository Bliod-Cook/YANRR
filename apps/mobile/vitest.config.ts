import { defineConfig } from "vitest/config"

export default defineConfig({
  root: import.meta.dirname,
  test: {
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "src/**/*.spec.ts",
      "scripts/**/*.test.ts",
      "plugins/**/*.test.ts",
    ],
    // Processed by Vite, so tests can stand in for the React Native modules it imports
    server: { deps: { inline: ["@better-auth/expo"] } },
  },
})
