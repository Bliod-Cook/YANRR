import { describe, expect, it, vi } from "vitest"

import { db } from "../db"
import { imagesTable } from "../schemas"
import { IMAGES_KEPT, ImagesService } from "./image"

vi.mock("../db", async () => (await import("../test-db")).createTestDB())

describe("ImagesService.getImagesToHydrate", () => {
  it("keeps the colours of the most recent images only", async () => {
    const colors = {
      platform: "ios",
      background: "#000",
      primary: "#000",
      secondary: "#000",
      detail: "#000",
    } as const
    await db.insert(imagesTable).values(
      Array.from({ length: IMAGES_KEPT + 1 }, (_, index) => ({
        url: `https://example.com/${index}.png`,
        colors,
        createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1000),
      })),
    )

    const images = await ImagesService.getImagesToHydrate()

    expect(images).toHaveLength(IMAGES_KEPT)
    expect(images.map((image) => image.url)).not.toContain("https://example.com/0.png")
    expect(await db.query.imagesTable.findMany()).toHaveLength(IMAGES_KEPT)
  })
})
