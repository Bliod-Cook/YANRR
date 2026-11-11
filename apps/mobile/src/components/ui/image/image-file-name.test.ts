import { describe, expect, it } from "vitest"

import { getImageFileName } from "./image-file-name"

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0))
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])
const WEBP = Uint8Array.from([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")])

describe("getImageFileName", () => {
  it("names the file after the image's actual format", () => {
    expect(getImageFileName("https://cdn.example.com/photos/a.jpg?w=600", PNG)).toBe("a.png")
    expect(getImageFileName("https://pbs.example.com/media/abc?format=jpg", JPEG)).toBe("abc.jpg")
    expect(getImageFileName("https://example.com/my%20photo.webp", WEBP)).toBe("my_20photo.webp")
  })

  it("keeps the name from the URL for a format it does not know", () => {
    expect(
      getImageFileName("https://example.com/icon.svg#top", Uint8Array.from(ascii("<svg"))),
    ).toBe("icon.svg")
  })
})
