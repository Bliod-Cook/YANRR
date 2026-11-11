// What the desktop app's preload script hands the page
declare const globalThis: {
  window?: { api?: { canWindowBlur: boolean } }
  electron?: object
}
// Inlined by the mobile bundler
declare const process: { env: { NODE_ENV?: string } }

export enum ModeEnum {
  development = "development",
  staging = "staging",
  production = "production",
}

export const MODE = import.meta.env?.MODE as ModeEnum

export const { PROD } = import.meta.env ?? {}

// Fixed when the desktop app is built, so that nothing in the environment an installed app runs
// in turns its development behaviour on. Only the mobile bundler has no `import.meta.env`.
export const DEV: boolean = import.meta.env?.DEV ?? process.env.NODE_ENV === "development"

export const APP_ID = "io.github.bliodcook.yanrr"
export const APP_PROTOCOL = DEV ? "yanrr-dev" : "yanrr"

export const SYSTEM_CAN_UNDER_BLUR_WINDOW = globalThis.window?.api?.canWindowBlur ?? false

declare const ELECTRON: boolean
/**
 * Current build type for electron
 */
export const ELECTRON_BUILD = !!ELECTRON
export const WEB_BUILD = !ELECTRON

export const IN_ELECTRON = !!globalThis["electron"] || ELECTRON_BUILD
