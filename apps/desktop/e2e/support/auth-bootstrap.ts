import type { Page } from "@playwright/test"

import type { TestAccount } from "./account"
import { waitForAuthenticated } from "./app"
import type { DesktopE2EEnv } from "./env"
import { buildWebAppURL } from "./env"

type AuthBootstrapResponse = {
  error?: {
    message?: string
  } | null
}

// Through the page's context, whose cookie store keeps the session cookie the server sets, as
// the browser would
const requestAuth = async (page: Page, url: string, body: Record<string, unknown>) => {
  const response = await page.context().request.post(url, {
    data: body,
    headers: { "Cache-Control": "no-store" },
  })

  return {
    response,
    body: (await response.json().catch(() => null)) as AuthBootstrapResponse | null,
  }
}

const signIn = (page: Page, env: DesktopE2EEnv, account: TestAccount) =>
  requestAuth(page, `${env.apiURL}/better-auth/sign-in/email`, {
    email: account.email,
    password: account.password,
    rememberMe: true,
  })

const signUp = (page: Page, env: DesktopE2EEnv, account: TestAccount) =>
  requestAuth(page, `${env.apiURL}/better-auth/sign-up/email`, {
    email: account.email,
    password: account.password,
    name: account.email.split("@")[0] ?? account.email,
    callbackURL: `${env.webURL}/login`,
  })

export const bootstrapAuthenticatedWebSession = async (
  page: Page,
  env: DesktopE2EEnv,
  account: TestAccount,
) => {
  let signInResult = await signIn(page, env, account)

  if (!signInResult.response.ok() || signInResult.body?.error) {
    const signUpResult = await signUp(page, env, account)
    const signUpError = signUpResult.body?.error?.message?.toLowerCase() ?? ""
    const isExistingAccount =
      signUpError.includes("exist") ||
      signUpError.includes("already") ||
      signUpError.includes("taken")

    if ((!signUpResult.response.ok() || signUpResult.body?.error) && !isExistingAccount) {
      throw new Error(
        signUpResult.body?.error?.message ||
          signInResult.body?.error?.message ||
          `auth bootstrap failed with ${signUpResult.response.status()}`,
      )
    }

    signInResult = await signIn(page, env, account)
  }

  if (!signInResult.response.ok() || signInResult.body?.error) {
    throw new Error(
      signInResult.body?.error?.message || `sign in failed with ${signInResult.response.status()}`,
    )
  }

  await page.goto(buildWebAppURL(env, "/"), { waitUntil: "domcontentloaded" })
  await waitForAuthenticated(page)
}
