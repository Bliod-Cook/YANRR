import type { ElectronBridge } from "@follow/electron-main"

declare global {
  interface Window {
    electron?: ElectronBridge
    api?: { canWindowBlur: boolean }
    platform: NodeJS.Platform
    /** The server's addresses overriding `@follow/shared/env.desktop`, see `env.desktop.ts` */
    __followEnv?: Record<string, string>
  }
  export const APP_NAME = "Yanrr"
}

export {}
