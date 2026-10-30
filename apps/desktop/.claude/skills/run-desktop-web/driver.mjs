// Drives the web client in headless Chromium: one command per line on stdin, one result line per command.
// Commands are listed in SKILL.md; Playwright comes from $PLAYWRIGHT_DIR (see SKILL.md for installing it).
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import readline from "node:readline"

const playwrightDir = process.env.PLAYWRIGHT_DIR ?? `${tmpdir()}/yanrr-playwright`
const { chromium } = createRequire(`${playwrightDir}/node_modules/`)("playwright")
const web = process.env.WEB_URL ?? "http://localhost:2233"
const shots = process.env.SHOTS_DIR ?? `${tmpdir()}/yanrr-web/shots`
mkdirSync(shots, { recursive: true })

// Proxies set in the environment would otherwise catch requests to localhost.
const browser = await chromium.launch({ args: ["--no-proxy-server"] })
// A fixed locale keeps the UI, and so the labels commands look for, in English.
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "en-US",
})
const page = await context.newPage()
const errors = []
const calls = []
const answered = new Set()
page.on("console", (message) => message.type() === "error" && errors.push(message.text()))
page.on("response", (response) => {
  const url = new URL(response.url())
  if (!url.pathname.startsWith("/api/")) return
  calls.push(`${response.request().method()} ${url.pathname} ${response.status()}`)
  answered.add(url.pathname)
})

// Requests share the page's cookies; the server checks their origin.
const request = (method, path, data) =>
  context.request.fetch(`${web}/api${path}`, { method, data, headers: { Origin: web } })
const answer = async (response) => `${response.status()} ${(await response.text()).slice(0, 300)}`

const commands = {
  signup: async (email, password) =>
    answer(
      await request("POST", "/better-auth/sign-up/email", {
        email,
        password,
        name: email.split("@")[0],
      }),
    ),
  signin: async (email, password) =>
    answer(await request("POST", "/better-auth/sign-in/email", { email, password })),
  api: async (method, path, ...json) =>
    answer(await request(method, path, json.length > 0 ? JSON.parse(json.join(" ")) : undefined)),
  nav: async (path) => {
    await page.goto(`${web}${path}`)
    return page.url()
  },
  // Text locators reach into the shadow DOM that entry content renders in.
  "wait-text": async (...text) => {
    await page.getByText(text.join(" ")).first().waitFor({ timeout: 120_000 })
    return "found"
  },
  // Waits for a response from that API path, unless one came already.
  "wait-call": async (path) => {
    if (!answered.has(path)) {
      await page.waitForResponse((response) => new URL(response.url()).pathname === path, {
        timeout: 120_000,
      })
    }
    return "answered"
  },
  click: async (...text) => {
    await page.getByText(text.join(" "), { exact: true }).first().click()
    return "clicked"
  },
  // Flips the switch of the settings row labeled so.
  toggle: async (...label) => {
    const row = page.getByText(label.join(" "), { exact: true }).first()
    const toggle = row
      .locator("xpath=ancestor::*[.//*[@role='switch']][1]")
      .getByRole("switch")
      .first()
    await toggle.click()
    return `aria-checked=${await toggle.getAttribute("aria-checked")}`
  },
  // Picks an option of the select with that test id.
  select: async (testId, ...option) => {
    await page.getByTestId(testId).click()
    await page.getByRole("option", { name: option.join(" "), exact: true }).click()
    return (await page.getByTestId(testId).textContent()).trim()
  },
  shot: async (name = "screenshot") => {
    const path = `${shots}/${name}.png`
    await page.screenshot({ path })
    return path
  },
  calls: async () => calls.splice(0).join(", ") || "none",
  errors: async () => errors.splice(0).join("\n") || "none",
  sleep: async (ms) => {
    await page.waitForTimeout(Number(ms))
    return "slept"
  },
  eval: async (...script) => JSON.stringify(await page.evaluate(script.join(" "))),
}

for await (const line of readline.createInterface({ input: process.stdin })) {
  const [name, ...args] = line.trim().split(/\s+/)
  if (!name || name.startsWith("#")) continue
  if (name === "quit") break
  const command = commands[name]
  try {
    console.log(`${line.trim()} -> ${command ? await command(...args) : "unknown command"}`)
  } catch (error) {
    console.log(`${line.trim()} -> ERROR ${error.message.split("\n")[0]}`)
  }
}
await browser.close()
