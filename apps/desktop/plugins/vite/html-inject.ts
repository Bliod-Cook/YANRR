import type { env as EnvType } from "@follow/shared/env.desktop"
import type { PluginOption } from "vite"

export function htmlInjectPlugin(env: typeof EnvType): PluginOption {
  return {
    name: "html-transform",
    enforce: "post",
    transformIndexHtml(html) {
      return html.replace(
        "<!-- FOLLOW VITE BUILD INJECT -->",
        `<script id="env_injection" type="module">
      ${function injectEnv(buildEnv: { VITE_API_URL?: string; VITE_WEB_URL?: string }) {
        const runtime = globalThis as { __followEnv?: Record<string, string> }
        const followEnv = (runtime.__followEnv ??= {})
        // Without a build-time value, the web app talks to the server that hosts it
        followEnv.VITE_WEB_URL ??= buildEnv.VITE_WEB_URL || window.location.origin
        followEnv.VITE_API_URL ??= buildEnv.VITE_API_URL || `${window.location.origin}/api`
      }.toString()}
      injectEnv(${JSON.stringify({
        VITE_API_URL: env.VITE_API_URL,
        VITE_WEB_URL: env.VITE_WEB_URL,
      })})
      </script>`,
      )
    },
  }
}
