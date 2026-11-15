import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { resolve } from "pathe"
import tsconfigPath from "vite-tsconfig-paths"
import { defineProject } from "vitest/config"

import { astPlugin } from "../../plugins/vite/ast"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
// The desktop app's package, which `@pkg` stands for in the builds
const pkgPath = resolve(__dirname, "../../package.json")
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))

export default defineProject({
  root: "./",
  test: {
    globals: true,
    setupFiles: [resolve(__dirname, "./setup-file.ts")],
    environment: "happy-dom",
    // Embedded players are third-party pages; tests must not fetch them
    environmentOptions: { happyDOM: { settings: { disableIframePageLoading: true } } },
    alias: {
      "@pkg": pkgPath,
      "@locales": resolve(__dirname, "../../../../locales"),
    },
  },

  define: {
    APP_VERSION: JSON.stringify(pkg.version),
    APP_NAME: JSON.stringify(pkg.productName),
    APP_DEV_CWD: JSON.stringify(process.cwd()),

    GIT_COMMIT_SHA: "'SHA'",
    DEBUG: process.env.DEBUG === "true",
    ELECTRON: "false",
  },

  plugins: [
    astPlugin,
    tsconfigPath({
      projects: ["./tsconfig.json"],
    }),
  ],
})
