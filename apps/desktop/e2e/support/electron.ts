import { execSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"

import type { ElectronApplication, Page } from "@playwright/test"
import { _electron as electron } from "@playwright/test"
import { join } from "pathe"

import type { DesktopE2EEnv } from "./env"

let built = false

const ensureElectronBuilt = (env: DesktopE2EEnv) => {
  if (built) {
    return
  }

  execSync("pnpm run build:electron-vite", {
    cwd: env.desktopAppDir,
    stdio: "inherit",
  })

  built = true
}

export const launchElectronApp = async (env: DesktopE2EEnv) => {
  ensureElectronBuilt(env)

  const userDataDir = await mkdtemp(join(tmpdir(), "yanrr-e2e-"))
  const electronApp = await electron.launch({
    args: [env.desktopAppDir],
    cwd: env.desktopAppDir,
    env: {
      ...process.env,
      CI: process.env.CI ?? "1",
      NODE_ENV: "test",
      YANRR_SERVER_URL: env.serverURL,
      YANRR_E2E_USER_DATA_DIR: userDataDir,
    },
    timeout: 120_000,
  })

  const page = await electronApp.firstWindow()
  // Electron exposes its initial about:blank window before loading the renderer.
  await page.waitForURL((url) => url.protocol !== "about:", { waitUntil: "domcontentloaded" })

  return {
    electronApp,
    page,
    userDataDir,
  }
}

export const closeElectronApp = async (app: {
  electronApp: ElectronApplication
  page: Page
  userDataDir: string
}) => {
  await app.electronApp.close().catch(() => {})
  await rm(app.userDataDir, { force: true, recursive: true })
}
