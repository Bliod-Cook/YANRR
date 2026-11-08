import { describe, expect, it, vi } from "vitest"

import { toSecureImageUrl } from "./image"

vi.mock("./server-env", () => ({
  serverEnv: { API_URL: "http://192.168.1.2:3000/api" },
}))

describe("toSecureImageUrl", () => {
  it("loads images over HTTPS", () => {
    expect(toSecureImageUrl("http://example.com/cover.png")).toBe("https://example.com/cover.png")
  })

  it("leaves the server's own images alone, which a home network serves without HTTPS", () => {
    const icon = "http://192.168.1.2:3000/api/icons/example.com"
    expect(toSecureImageUrl(icon)).toBe(icon)
  })
})
