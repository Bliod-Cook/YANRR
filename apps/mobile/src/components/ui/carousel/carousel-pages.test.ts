import type { MediaModel } from "@follow/database/schemas/types"
import { describe, expect, it } from "vitest"

import { getCarouselPages } from "./carousel-pages"

describe("getCarouselPages", () => {
  it("gives a page to each media with an image, which keeps its media index", () => {
    const media: MediaModel[] = [
      { type: "photo", url: "https://example.com/a.jpg" },
      { type: "video", url: "https://example.com/no-poster.mp4" },
      {
        type: "video",
        url: "https://example.com/b.mp4",
        preview_image_url: "https://example.com/b.jpg",
      },
    ]

    expect(getCarouselPages(media).map(({ index, imageUrl }) => ({ index, imageUrl }))).toEqual([
      { index: 0, imageUrl: "https://example.com/a.jpg" },
      { index: 2, imageUrl: "https://example.com/b.jpg" },
    ])
  })
})
