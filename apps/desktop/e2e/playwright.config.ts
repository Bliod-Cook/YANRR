import { defineConfig, devices } from "@playwright/test"

import { FEED_SERVER_PORT, resolveDesktopE2EEnv } from "./support/env"

const env = resolveDesktopE2EEnv()

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: env.webBaseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    serviceWorkers: "block",
  },
  webServer: [
    {
      command: "pnpm run dev:web",
      cwd: env.desktopAppDir,
      url: env.webBaseURL,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `node e2e/support/feed-server.mjs ${FEED_SERVER_PORT}`,
      cwd: env.desktopAppDir,
      port: FEED_SERVER_PORT,
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    {
      name: "web",
      testMatch: /tests\/web\/.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium",
      },
    },
    {
      name: "electron",
      testMatch: /tests\/electron\/.*\.spec\.ts/,
    },
  ],
})
