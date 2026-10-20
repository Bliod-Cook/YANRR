/**
 * This env for apps/desktop
 */
import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

export const env = createEnv({
  clientPrefix: "VITE_",
  // The server and its API: the web build defaults to the server that hosts it (see
  // `plugins/vite/html-inject.ts`), Electron gets the one the user set from its preload script
  client: {
    VITE_WEB_URL: z.string().url(),
    VITE_API_URL: z.string(),
    /** Firebase web config (JSON) of the deployment, for push notifications */
    VITE_FIREBASE_CONFIG: z.string().optional(),
  },

  emptyStringAsUndefined: true,
  runtimeEnv: getRuntimeEnv() as any,

  skipValidation: "process" in globalThis ? process.env.VITEST === "true" : false,
})

function metaEnvIsEmpty() {
  try {
    return Object.keys(import.meta.env || {}).length === 0
  } catch {
    return true
  }
}

function getRuntimeEnv() {
  try {
    if (metaEnvIsEmpty()) {
      return process.env
    }
    return injectExternalEnv(import.meta.env)
  } catch {
    return process.env
  }
}

declare const globalThis: any
function injectExternalEnv<T>(originEnv: T): T {
  if (!("document" in globalThis)) {
    return originEnv
  }
  const prefix = "__followEnv"
  const env = globalThis[prefix]
  if (!env) {
    return originEnv
  }

  for (const key in env) {
    originEnv[key as keyof T] = env[key]
  }
  return originEnv
}
