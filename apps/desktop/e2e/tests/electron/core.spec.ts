import { expect, test } from "@playwright/test"

import { createTestAccount } from "../../support/account"
import {
  dismissFeedForm,
  expectTimelineSwitchAndEntryReadFlow,
  followOnboardingFeed,
  loginWithCredential,
  logoutFromProfileMenu,
  registerWithCredential,
  unsubscribeFirstFeedFromSettings,
} from "../../support/app"
import { closeElectronApp, launchElectronApp } from "../../support/electron"
import { resolveDesktopE2EEnv } from "../../support/env"

test.describe("electron core flows", () => {
  test("covers registration, login, follow, unfollow, timeline and read state", async () => {
    test.setTimeout(240_000)

    const env = resolveDesktopE2EEnv()
    const account = createTestAccount("electron-core")
    let electronApp = await launchElectronApp(env)

    try {
      await test.step("loads the preload bridge", async () => {
        expect(await electronApp.page.evaluate(() => Boolean(window.electron?.invoke))).toBe(true)
      })

      await test.step("registers a new account", async () => {
        await registerWithCredential(electronApp.page, account)
      })

      await test.step("logs out and logs back in", async () => {
        await logoutFromProfileMenu(electronApp.page)
        await closeElectronApp(electronApp)
        electronApp = await launchElectronApp(env)
        await loginWithCredential(electronApp.page, account)
      })

      await test.step("follows onboarding feed", async () => {
        await followOnboardingFeed(electronApp.page, env)
        await dismissFeedForm(electronApp.page)
      })

      await test.step("switches timeline, opens an entry, and toggles read state", async () => {
        await expectTimelineSwitchAndEntryReadFlow(electronApp.page)
      })

      await test.step("unsubscribes onboarding feed from settings", async () => {
        await unsubscribeFirstFeedFromSettings(electronApp.page)
      })
    } finally {
      await closeElectronApp(electronApp)
    }
  })
})
