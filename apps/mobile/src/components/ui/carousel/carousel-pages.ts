import type { MediaModel } from "@follow/database/schemas/types"

/**
 * The carousel's pages, each with its indicator. Media without an image get none, so a page's
 * position can differ from `index`, its media's position.
 */
export const getCarouselPages = (media: MediaModel[]) =>
  media.flatMap((m, index) => {
    const imageUrl = m.type === "video" ? m.preview_image_url : m.url
    return imageUrl ? [{ media: m, index, imageUrl }] : []
  })
