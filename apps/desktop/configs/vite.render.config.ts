import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import { codeInspectorPlugin } from "code-inspector-plugin"
import { dirname, resolve } from "pathe"
import { prerelease } from "semver"
import type { UserConfig } from "vite"

import { getGitHash } from "../../../scripts/lib"
import { astPlugin } from "../plugins/vite/ast"
import { circularImportRefreshPlugin } from "../plugins/vite/hmr"
import { customI18nHmrPlugin } from "../plugins/vite/i18n-hmr"
import { localesJsonPlugin } from "../plugins/vite/locales-json"
import i18nCompleteness from "../plugins/vite/utils/i18n-completeness"

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(readFileSync(resolve(pkgDir, "./package.json"), "utf8"))

export const viteRenderBaseConfig = {
  worker: {
    format: "es",
  },
  optimizeDeps: {
    exclude: ["sqlocal", "wa-sqlite", "@follow-app/client-sdk"],
  },
  resolve: {
    alias: {
      "~": resolve("layer/renderer/src"),
      "@pkg": resolve("package.json"),
      "@locales": resolve("../../locales"),
      "@follow/electron-main": resolve("layer/main/src"),
    },
  },
  base: "/",

  plugins: [
    {
      name: "import-sql",
      transform(code, id) {
        if (id.endsWith(".sql")) {
          const json = JSON.stringify(code)
            .replaceAll("\u2028", "\\u2028")
            .replaceAll("\u2029", "\\u2029")

          return {
            code: `export default ${json}`,
          }
        }
      },
    },
    localesJsonPlugin(),
    codeInspectorPlugin({
      bundler: "vite",
      hotKeys: ["altKey"],
      needEnvInspector: true,
    }),
    react({
      // jsxImportSource: "@welldone-software/why-did-you-render", // <-----
    }),
    circularImportRefreshPlugin(),

    astPlugin,
    customI18nHmrPlugin(),
  ],
  define: {
    APP_VERSION: JSON.stringify(pkg.version),
    APP_NAME: JSON.stringify(pkg.productName),
    APP_DEV_CWD: JSON.stringify(process.cwd()),

    GIT_COMMIT_SHA: JSON.stringify(getGitHash()),

    RELEASE_CHANNEL: JSON.stringify((prerelease(pkg.version)?.[0] as string) || "stable"),

    DEBUG: process.env.DEBUG === "true",

    I18N_COMPLETENESS_MAP: JSON.stringify({ ...i18nCompleteness, en: 100 }),
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV),
  },
} satisfies UserConfig
