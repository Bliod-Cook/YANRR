import { expect, test } from "@playwright/test"
import sharp from "sharp"

test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })

test("timeline dividers reach the top through the Windows titlebar spacing", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort())

  for (const view of ["articles", "audios", "notifications"]) {
    await page.goto(`/timeline/${view}/all/pending`)
    await page.evaluate(() => document.body.style.setProperty("--fo-window-padding-top", "30px"))

    const entryColumn = page.locator("main .border-r")
    await expect(entryColumn).toBeVisible({ timeout: 30_000 })
    const bounds = (await entryColumn.boundingBox())!
    expect(bounds.y).toBe(20)

    const image = await sharp(await page.screenshot({ animations: "disabled" }))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const pixel = (x: number, y: number) => {
      const offset = (y * image.info.width + x) * image.info.channels
      return [...image.data.subarray(offset, offset + image.info.channels)]
    }
    const x = Math.round(bounds.x + bounds.width) - 1
    const border = pixel(x, 30)
    expect(border).not.toEqual(pixel(x - 1, 30))
    for (const y of [0, 10, 19]) {
      expect(pixel(x, y), `${view}: divider at y=${y}`).toEqual(border)
    }
  }
})
