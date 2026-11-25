import { describe, expect, test } from "vitest"

import { getImageSrc } from "./image-proxy"

const proxy = { url: "https://img.example.com", key: "test-key" }
const serverUrl = "https://rss.example.com"

describe("getImageSrc", () => {
  test("signs the image url as the image proxy checks it", () => {
    // The same signature as the proxy's own test
    expect(
      getImageSrc("https://example.com/a.png?x=1&y=中", { mode: "all", proxy, serverUrl }),
    ).toBe(
      "https://img.example.com/xzxCVa98o_QdAQ7LNzZes-RvDHXy-FZ5pjz8j6U5B9k/aHR0cHM6Ly9leGFtcGxlLmNvbS9hLnBuZz94PTEmeT3kuK0",
    )
  })

  test("proxies only hotlink-protected hosts in hotlink mode", () => {
    const options = { mode: "hotlink", proxy, serverUrl } as const
    expect(getImageSrc("https://i.pximg.net/a.png", options)).toMatch(
      /^https:\/\/img\.example\.com\//,
    )
    expect(getImageSrc("https://example.com/a.png", options)).toBe("https://example.com/a.png")
  })

  test("leaves the url alone when off, without a proxy, or not a remote image", () => {
    const image = "https://example.com/a.png"
    expect(getImageSrc(image, { mode: "off", proxy, serverUrl })).toBe(image)
    expect(getImageSrc(image, { mode: "all", proxy: null, serverUrl })).toBe(image)
    for (const src of [
      `${serverUrl}/api/icons/example.com`,
      "data:image/png;base64,iVBORw0KGgo=",
      "blob:https://rss.example.com/1",
    ]) {
      expect(getImageSrc(src, { mode: "all", proxy, serverUrl })).toBe(src)
    }
  })

  test("proxies without a server url to keep out", () => {
    expect(getImageSrc("https://example.com/a.png", { mode: "all", proxy, serverUrl: "" })).toMatch(
      /^https:\/\/img\.example\.com\//,
    )
  })

  test("keeps http so that the proxy fetches what the feed names", () => {
    const proxied = getImageSrc("http://example.com/a.png", { mode: "all", proxy, serverUrl })
    const encoded = proxied.split("/").at(-1)!
    expect(atob(encoded.replaceAll("-", "+").replaceAll("_", "/"))).toBe("http://example.com/a.png")
  })
})
