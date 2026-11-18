import { getStorageNS } from "@follow/utils/ns"
import { expect, test, vi } from "vitest"

test("resumes a saved muted episode with the audio element muted", async () => {
  const key = getStorageNS("player")
  localStorage.setItem(
    key,
    JSON.stringify({ src: "https://example.com/episode.mp3", isMute: true }),
  )
  const { AudioPlayer } = await import("./player")
  vi.spyOn(AudioPlayer.audio, "play").mockResolvedValue(undefined)
  try {
    await AudioPlayer.mount(AudioPlayer.get())
    expect(AudioPlayer.audio.muted).toBe(true)
  } finally {
    AudioPlayer.close()
    vi.restoreAllMocks()
    localStorage.removeItem(key)
  }
})
