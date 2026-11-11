import { FeedViewType } from "@follow/constants"
import type { EntryModel } from "@follow/store/entry/types"
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest"

import { EntryContentHTMLRenderer } from "./html"

const { useEntryMock, mediaMock } = vi.hoisted(() => ({
  useEntryMock: vi.fn(),
  mediaMock: vi.fn(({ src }: { src?: string }) => <img src={src} alt="" />),
}))

vi.mock("@follow/store/entry/hooks", () => ({ useEntry: useEntryMock }))
vi.mock("@follow/store/feed/getter", () => ({ getFeedById: () => null }))
vi.mock("~/atoms/settings/spotlight", () => ({ useSpotlightSettingKey: () => [] }))
vi.mock("~/components/ui/media/Media", () => ({ Media: mediaMock }))
vi.mock("~/providers/wrapped-element-provider", () => ({
  useWrappedElementSize: () => ({ h: 0, w: 640 }),
}))

const coverImageUrl = "https://example.com/images/cover.jpg"
const cover = { type: "photo" as const, url: coverImageUrl, width: 1200, height: 800 }
const entry: Pick<EntryModel, "url" | "media"> = {
  url: "https://example.com/article",
  media: [cover],
}

const renderContent = (content: string, noMedia = false) => {
  const container = document.createElement("div")
  container.innerHTML = renderToStaticMarkup(
    <EntryContentHTMLRenderer
      entryId="entry-with-cover"
      feedId="feed-1"
      view={FeedViewType.Articles}
      as="article"
      noMedia={noMedia}
    >
      {content}
    </EntryContentHTMLRenderer>,
  )
  return container.querySelector("article")
}

describe("entry HTML cover rendering", () => {
  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  })

  beforeEach(() => {
    vi.clearAllMocks()
    useEntryMock.mockImplementation((_id, selector) => selector(entry))
  })

  test("renders the missing cover before the body through the existing media preview", () => {
    const article = renderContent("<p>Article body</p>")

    expect(article?.firstElementChild?.getAttribute("src")).toBe(coverImageUrl)
    expect(article?.lastElementChild?.textContent).toBe("Article body")
    expect(mediaMock).toHaveBeenCalledWith(
      expect.objectContaining({ src: coverImageUrl, width: 1200, height: 800, popper: true }),
      undefined,
    )
  })

  test("keeps an existing cover in its original body position", () => {
    const article = renderContent('<p>Article body</p><img src="/images/cover.jpg">')

    expect(article?.querySelectorAll("img")).toHaveLength(1)
    expect(article?.firstElementChild?.textContent).toBe("Article body")
  })

  test("does not render the cover when media is hidden", () => {
    expect(renderContent("<p>Article body</p>", true)?.querySelector("img")).toBeNull()
    expect(mediaMock).not.toHaveBeenCalled()
  })
})

describe("entry HTML addresses", () => {
  // Links render tooltips through portals, which only a client render supports
  const renderClient = async (content: string) => {
    const container = document.createElement("div")
    const root = createRoot(container)
    await act(async () =>
      root.render(
        <EntryContentHTMLRenderer
          entryId="entry"
          feedId="feed-1"
          view={FeedViewType.Articles}
          as="article"
        >
          {content}
        </EntryContentHTMLRenderer>,
      ),
    )
    const article = container.querySelector("article")
    await act(async () => root.unmount())
    return article
  }

  beforeAll(() => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    vi.clearAllMocks()
    useEntryMock.mockImplementation((_id, selector) =>
      selector({ url: "https://example.com/blog/post", media: [] }),
    )
  })

  test("resolves relative links, images and videos against the entry's URL", async () => {
    const article = await renderClient(
      '<p><a href="next.html">Next</a> <img src="images/a.png"></p><video src="v.mp4" poster="/p.jpg"></video>',
    )

    expect(article?.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com/blog/next.html",
    )
    expect(mediaMock).toHaveBeenCalledWith(
      expect.objectContaining({ src: "https://example.com/blog/images/a.png" }),
      undefined,
    )
    expect(mediaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        src: "https://example.com/blog/v.mp4",
        previewImageUrl: "https://example.com/p.jpg",
      }),
      undefined,
    )
  })

  test("resolves iframes against the entry's URL and drops those from the app's own origin", async () => {
    const article = await renderClient(
      `<iframe src="/embed/1"></iframe><iframe src="${window.location.origin}/"></iframe>`,
    )

    expect([...(article?.querySelectorAll("iframe") ?? [])].map((iframe) => iframe.src)).toEqual([
      "https://example.com/embed/1",
    ])
  })
})
