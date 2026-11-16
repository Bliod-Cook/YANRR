import type { Locator, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })

const action = (page: Page, label: string) =>
  page.locator('[aria-roledescription="sortable"]').filter({ hasText: label })

const center = async (locator: Locator) => {
  const box = (await locator.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

const toolbars = (page: Page) =>
  page.evaluate(() => {
    const actions = [...document.querySelectorAll('[aria-roledescription="sortable"]')]
    const grids = [...new Set(actions.map((element) => element.parentElement!))]
    return grids.map((grid) => [...grid.children].map((element) => element.textContent!.trim()))
  })

const startDrag = async (page: Page, label: string) => {
  const { x, y } = await center(action(page, label))
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 10, y + 10, { steps: 2 })
}

const textsAt = (page: Page, point: { x: number; y: number }) =>
  page.evaluate(
    ({ x, y }) => document.elementsFromPoint(x, y).map((element) => element.textContent!.trim()),
    point,
  )

test.beforeEach(async ({ page }) => {
  // Without a server AI is off, so Quick Actions keeps the AI summary action without showing it
  await page.route("**/api/**", (route) => route.abort())
  await page.goto("/settings/appearance")
  // The timeline behind the settings dispatches a resize when it mounts, which cancels a drag
  await expect(page.locator("main .border-r")).toBeAttached({ timeout: 30_000 })
  await page
    .getByText("Customize Toolbar", { exact: true })
    .locator("..")
    .getByRole("button", { name: "Customize" })
    .click()
  await expect(action(page, "Share")).toBeVisible({ timeout: 30_000 })
  // The modal springs open, and the tests compare positions
  await expect(async () => {
    const share = await center(action(page, "Share"))
    await page.waitForTimeout(100)
    expect(await center(action(page, "Share"))).toEqual(share)
  }).toPass()
})

test("previews a move within Quick Actions past an action that is not shown", async ({ page }) => {
  const star = await center(action(page, "Star / UnStar"))
  const readability = await center(action(page, "Readability"))
  await startDrag(page, "Mark as Read / UnRead")
  await page.mouse.move(readability.x, readability.y, { steps: 10 })

  await expect
    .poll(async () => (await center(action(page, "Readability"))).x)
    .toBeCloseTo(star.x, 0)

  await page.mouse.up()
  await expect
    .poll(async () => (await toolbars(page))[0])
    .toEqual([
      "Star / UnStar",
      "Readability",
      "Mark as Read / UnRead",
      "View Source Content",
      "Share",
    ])
})

test("drags an action into the other area under the pointer without bouncing", async ({ page }) => {
  const updateLoops: string[] = []
  page.on("pageerror", (error) => updateLoops.push(error.message))
  page.on("console", (message) => {
    if (message.text().includes("Maximum update depth")) updateLoops.push(message.text())
  })
  const star = await center(action(page, "Star / UnStar"))
  const viewSource = await center(action(page, "View Source Content"))
  const exportAsPDF = await center(action(page, "Export as PDF"))

  await startDrag(page, "Image Gallery")
  // Held here, an action moved between the areas on every drag over until React threw #185
  await page.mouse.move(viewSource.x, (viewSource.y + exportAsPDF.y) / 2, { steps: 10 })
  await page.waitForTimeout(500)
  await page.mouse.move(star.x, star.y, { steps: 10 })

  await expect.poll(() => textsAt(page, star)).toContain("Image Gallery")
  expect(updateLoops).toEqual([])

  await page.mouse.up()
  await expect
    .poll(() => toolbars(page))
    .toEqual([
      [
        "Mark as Read / UnRead",
        "Image Gallery",
        "Star / UnStar",
        "Readability",
        "View Source Content",
        "Share",
      ],
      ["Open in New Tab", "Copy Link", "Copy Title", "Export as PDF", "Delete"],
    ])
})
