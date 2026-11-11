import react from "@vitejs/plugin-react"
import path from "pathe"
import type { Plugin } from "vite"
import { defineConfig } from "vite"

// Articles bring their own images, media, fonts, frames and styles; scripts only ever come from
// the bundle, so markup that slips past the sanitizer cannot run any. The page is a local file,
// hence `file:` next to 'self'.
const contentSecurityPolicy = [
  "default-src 'self' file:",
  "style-src 'self' file: 'unsafe-inline'",
  "img-src * data: blob:",
  "media-src * data: blob:",
  "font-src * file: data:",
  "frame-src *",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ")

// Only in the build: the dev server needs inline scripts for React Refresh
const contentSecurityPolicyPlugin: Plugin = {
  name: "content-security-policy",
  apply: "build",
  transformIndexHtml: () => [
    {
      tag: "meta",
      attrs: { "http-equiv": "Content-Security-Policy", content: contentSecurityPolicy },
      injectTo: "head-prepend",
    },
  ],
}

export default defineConfig({
  base: "",
  build: {
    outDir: path.resolve(import.meta.dirname, "../../../../out/rn-web/html-renderer"),
  },
  resolve: {
    alias: [
      {
        find: /^tailwindcss$/,
        replacement: path.resolve(
          import.meta.dirname,
          "../../../../node_modules/tailwindcss/index.css",
        ),
      },
      {
        find: "~",
        replacement: path.resolve(__dirname, "./src"),
      },
    ],
  },
  define: {
    ELECTRON: "false",
  },
  plugins: [react({}), contentSecurityPolicyPlugin],
})
