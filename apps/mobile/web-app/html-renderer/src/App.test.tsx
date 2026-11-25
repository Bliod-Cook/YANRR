import { WEBVIEW_BRIDGE_VERSION } from "@follow/shared/webview-bridge"
import { act, useLayoutEffect } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import type { EntryModel } from "../types"
import { App } from "./App"

// On Android the app may inject its `bridge` only after the page script ran
const postedMessages = vi.hoisted(() => {
  const messages: string[] = []
  vi.stubGlobal("ReactNativeWebView", { postMessage: (message: string) => messages.push(message) })
  return messages
})

const coverImageUrl = "https://example.com/images/cover.jpg"

// The apps parse their JSON before they call in
const renderEntry = (entry: EntryModel) => {
  window.__FO_BRIDGE__.dispatch("setEntry", { ...entry })
  const container = document.createElement("div")
  container.innerHTML = renderToStaticMarkup(<App />)
  return container.querySelector("article")
}

beforeEach(() => {
  window.__FO_BRIDGE__.dispatch("setNoMedia", false)
})

describe("links", () => {
  const audio = [{ url: "https://example.com/episode.mp3", mime_type: "audio/mpeg" }]

  test("keeps links whose text holds a colon links", () => {
    const article = renderEntry({
      attachments: audio,
      content:
        '<p><a href="https://example.com/a">https://example.com/a</a> <a href="https://example.com/b">Part 2: The end</a></p>',
    })

    expect(article?.querySelectorAll("a")).toHaveLength(2)
    expect(article?.querySelector("button")).toBeNull()
  })

  test("turns a timestamp into a seek button only in an entry with audio", () => {
    const content = '<p><a href="https://example.com/t">12:30</a></p>'

    expect(renderEntry({ attachments: audio, content })?.querySelector("button")?.textContent).toBe(
      "12:30",
    )
    expect(renderEntry({ content })?.querySelector("button")).toBeNull()
  })

  test("resolves relative addresses against the entry, else its site, and drops them without either", () => {
    const content = '<p><a href="/post/2">Next</a></p><p><img src="images/a.png"></p>'

    const article = renderEntry({ url: "https://example.com/articles/entry", content })
    expect(article?.querySelector("a")?.getAttribute("href")).toBe("https://example.com/post/2")
    expect(article?.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/articles/images/a.png",
    )

    const onSite = renderEntry({ siteUrl: "https://example.com/blog/", content })
    expect(onSite?.querySelector("a")?.getAttribute("href")).toBe("https://example.com/post/2")

    const withoutUrl = renderEntry({ content })
    expect(withoutUrl?.querySelector("a")?.hasAttribute("href")).toBe(false)
    expect(withoutUrl?.querySelector("img")?.hasAttribute("src")).toBe(false)
  })
})

describe("image proxy", () => {
  afterEach(() => {
    window.__FO_BRIDGE__.dispatch("setImageProxy", {
      mode: "off",
      proxy: null,
      serverUrl: "",
      fallback: false,
    })
  })

  test("loads images through the proxy, then once from their host when it fails", async () => {
    window.__FO_BRIDGE__.dispatch("setImageProxy", {
      mode: "all",
      proxy: { url: "https://img.example.com", key: "test-key" },
      serverUrl: "https://rss.example.com/api",
      fallback: true,
    })
    window.__FO_BRIDGE__.dispatch("setEntry", {
      content: '<p><img src="https://example.com/a.png"></p>',
    })
    const container = document.createElement("div")
    const root = createRoot(container)
    await act(async () => root.render(<App />))
    const image = () => container.querySelector("img")

    expect(image()?.getAttribute("src")).toMatch(/^https:\/\/img\.example\.com\//)
    await act(async () => image()!.dispatchEvent(new Event("error")))
    expect(image()?.getAttribute("src")).toBe("https://example.com/a.png")

    await act(async () => root.unmount())
  })
})

describe("article styles", () => {
  const renderStyles = async (renderInlineStyle: boolean) => {
    window.__FO_BRIDGE__.dispatch("setReaderRenderInlineStyle", renderInlineStyle)
    window.__FO_BRIDGE__.dispatch("setEntry", {
      content: '<style>p::after { content: "<b>x</b>" }</style><p>Body</p>',
    })
    const container = document.createElement("div")
    const root = createRoot(container)
    await act(async () => root.render(<App />))
    const styles = [...container.querySelectorAll("article style")].map((style) => ({
      text: style.textContent,
      elements: style.children.length,
    }))
    await act(async () => root.unmount())
    return styles
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  })

  test("renders a style block as text, and only with inline styles on", async () => {
    expect(await renderStyles(true)).toEqual([
      { text: 'p::after { content: "<b>x</b>" }', elements: 0 },
    ])
    expect(await renderStyles(false)).toEqual([])
  })
})

describe("entry cover image", () => {
  test("renders a cover without body content through the image preview component", () => {
    const article = renderEntry({
      media: [{ type: "photo", url: coverImageUrl }],
    })

    expect(article?.querySelectorAll("img")).toHaveLength(1)
    expect(article?.querySelector("button img")?.getAttribute("src")).toBe(coverImageUrl)
  })

  test("uses the article URL to avoid repeating an existing relative cover image", () => {
    const article = renderEntry({
      content: '<p>Article body</p><img src="/images/cover.jpg">',
      url: "https://example.com/articles/entry",
      media: [{ type: "photo", url: coverImageUrl }],
    })

    expect(article?.querySelectorAll("img")).toHaveLength(1)
    expect(article?.querySelector("img")?.getAttribute("src")).toBe(coverImageUrl)
    expect(article?.firstElementChild?.textContent).toBe("Article body")
  })

  test("does not promote another photo when the cover media is a video", () => {
    const article = renderEntry({
      content: "<p>Article body</p>",
      media: [
        { type: "video", url: "https://example.com/video.mp4" },
        { type: "photo", url: coverImageUrl },
      ],
    })

    expect(article?.querySelectorAll("img")).toHaveLength(0)
  })

  test("respects the media visibility setting for a cover-only entry", () => {
    window.__FO_BRIDGE__.dispatch("setNoMedia", true)

    const article = renderEntry({
      media: [{ type: "photo", url: coverImageUrl }],
    })

    expect(article).toBeNull()
  })
})

describe("reader style", () => {
  test("applies font family, line height and text color variables to the article", () => {
    window.__FO_BRIDGE__.dispatch("setReaderStyle", {
      fontFamily: "ui-serif, serif",
      lineHeight: 1.5,
      textColor: {
        light: { body: "#111111", strong: "#000000" },
        dark: { body: "#eeeeee", strong: "#ffffff" },
      },
    })
    const article = renderEntry({ content: "<p>Body</p>" })
    const style = article?.getAttribute("style") ?? ""

    expect(style).toContain("font-family:ui-serif, serif")
    expect(style).toContain("line-height:1.5")
    expect(style).toContain("--reader-body-light:#111111")
    expect(style).toContain("--reader-strong-dark:#ffffff")
    expect(article?.classList.contains("reader-text-color")).toBe(true)
  })

  test("keeps renderer defaults when the reader style is reset", () => {
    window.__FO_BRIDGE__.dispatch("setReaderStyle", {
      fontFamily: "inherit",
      lineHeight: 1.75,
      textColor: null,
    })
    const article = renderEntry({ content: "<p>Body</p>" })
    const style = article?.getAttribute("style") ?? ""

    expect(style).not.toContain("font-family")
    expect(style).toContain("line-height:1.75")
    expect(style).not.toContain("--reader-body-light")
    expect(article?.classList.contains("reader-text-color")).toBe(false)
  })
})

describe("embedded YouTube videos", () => {
  test("replaces a YouTube player with a thumbnail that opens the video", () => {
    const article = renderEntry({
      url: "https://example.com/article",
      content:
        '<p>Watch</p><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0" title="Demo"></iframe>',
    })

    expect(article?.querySelector("iframe")).toBeNull()
    const link = article?.querySelector("a[href='https://www.youtube.com/watch?v=dQw4w9WgXcQ']")
    expect(link?.querySelector("img")?.getAttribute("src")).toBe(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    )
  })

  test("keeps other iframes and YouTube playlists, in the reader's own sandbox", () => {
    const article = renderEntry({
      url: "https://example.com/article",
      content:
        '<iframe src="https://player.vimeo.com/video/1" sandbox="allow-scripts allow-top-navigation"></iframe><iframe src="https://www.youtube.com/embed/videoseries?list=PL1"></iframe>',
    })

    const iframes = [...(article?.querySelectorAll("iframe") ?? [])]
    expect(iframes.map((iframe) => iframe.getAttribute("sandbox"))).toEqual([
      "allow-scripts allow-same-origin allow-popups allow-forms",
      "allow-scripts allow-same-origin allow-popups allow-forms",
    ])
  })
})

describe("bridge", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  })

  test("tells the app its bridge version once it takes messages, before the app injected its bridge", () => {
    expect(postedMessages).toEqual([
      JSON.stringify({ type: "bridgeReady", payload: { version: WEBVIEW_BRIDGE_VERSION } }),
    ])
  })

  test("takes the booleans and numbers iOS replays as JSON text", () => {
    window.__FO_BRIDGE__.dispatch("setNoMedia", true)
    window.__FO_BRIDGE__.applyState({
      setNoMedia: "false",
      setEntry: { media: [{ type: "photo", url: coverImageUrl }] },
    })
    const container = document.createElement("div")
    container.innerHTML = renderToStaticMarkup(<App />)

    expect(container.querySelector("article img")?.getAttribute("src")).toBe(coverImageUrl)
  })

  test("shows an entry the app sends while the page mounts", async () => {
    // Lands after the page rendered and before it subscribed, as a message from the app can
    const SendEntry = () => {
      useLayoutEffect(() => {
        window.__FO_BRIDGE__.dispatch("setEntry", { content: "<p>Sent on mount</p>" })
      }, [])
      return null
    }
    const container = document.createElement("div")
    const root = createRoot(container)

    await act(async () =>
      root.render(
        <>
          <App />
          <SendEntry />
        </>,
      ),
    )

    expect(container.textContent).toContain("Sent on mount")
    await act(async () => root.unmount())
  })
})
