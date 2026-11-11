const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((byte, index) => bytes[offset + index] === byte)

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0))

const formats: { extension: string; matches: (bytes: Uint8Array) => boolean }[] = [
  { extension: "jpg", matches: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]) },
  { extension: "png", matches: (bytes) => startsWith(bytes, [0x89, ...ascii("PNG")]) },
  { extension: "gif", matches: (bytes) => startsWith(bytes, ascii("GIF8")) },
  {
    extension: "webp",
    matches: (bytes) => startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8),
  },
  { extension: "avif", matches: (bytes) => startsWith(bytes, ascii("ftypavif"), 4) },
  { extension: "heic", matches: (bytes) => startsWith(bytes, ascii("ftypheic"), 4) },
]

/**
 * A file name for the image at `url`, from the name in the URL and the format its first bytes
 * show. Saving to the photo library needs the format in the name, which neither every URL nor the
 * image cache's file carries.
 */
export const getImageFileName = (url: string, head: Uint8Array) => {
  const name = (url.split(/[?#]/)[0]!.split("/").pop() || "image").replace(/[^\w.-]/g, "_")
  const extension = formats.find((format) => format.matches(head))?.extension
  return extension ? `${name.replace(/\.[^.]*$/, "")}.${extension}` : name
}
