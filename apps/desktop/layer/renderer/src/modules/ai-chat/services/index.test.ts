import { describe, expect, it, vi } from "vitest"

import type { BizUIMessage } from "../store/types"
import { AIPersistService } from "."

vi.mock("@follow/database/db", async () =>
  (await import("@follow/database/test-db")).createTestDB(),
)

const textMessage = (
  id: string,
  role: BizUIMessage["role"],
  text: string,
  state: "streaming" | "done" = "done",
): BizUIMessage => ({
  id,
  role,
  createdAt: new Date(`2026-11-11T10:00:0${id.at(-1)}Z`),
  parts: [{ type: "text", text, state }],
})

const storedTexts = async (chatId: string) =>
  (await AIPersistService.loadUIMessages(chatId)).map((message) =>
    message.parts.map((part) => (part.type === "text" ? part.text : part.type)).join(""),
  )

describe("AIPersistService.saveMessages", () => {
  it("stores the messages a chat has now and drops the ones it no longer has", async () => {
    await AIPersistService.saveMessages("chat-1", [
      textMessage("am1", "user", "Hi"),
      textMessage("am2", "assistant", "Hello"),
      textMessage("am3", "user", "Tell me more"),
    ])
    await AIPersistService.saveMessages("chat-2", [textMessage("am4", "user", "Other chat")])

    // The user edited the first message: the rest of the chat is replaced
    await AIPersistService.saveMessages("chat-1", [textMessage("am1", "user", "Hi there")])

    expect(await storedTexts("chat-1")).toEqual(["Hi there"])
    expect(await storedTexts("chat-2")).toEqual(["Other chat"])
    expect((await AIPersistService.getChatSession("chat-1"))?.updatedAt).toEqual(
      new Date("2026-11-11T10:00:01Z"),
    )
  })

  it("keeps the stored version of a message that streams again", async () => {
    await AIPersistService.saveMessages("chat-3", [
      textMessage("bm1", "user", "Hi"),
      textMessage("bm2", "assistant", "Hello"),
    ])

    await AIPersistService.saveMessages("chat-3", [
      textMessage("bm1", "user", "Hi"),
      textMessage("bm2", "assistant", "Hel", "streaming"),
    ])

    expect(await storedTexts("chat-3")).toEqual(["Hi", "Hello"])
  })

  it("leaves the stored chat as it was when saving fails", async () => {
    await AIPersistService.saveMessages("chat-4", [textMessage("cm1", "user", "Hi")])

    const invalid = { ...textMessage("cm2", "user", "Lost"), role: null } as unknown as BizUIMessage
    await expect(
      AIPersistService.saveMessages("chat-4", [textMessage("cm3", "user", "New"), invalid]),
    ).rejects.toThrow()

    expect(await storedTexts("chat-4")).toEqual(["Hi"])
  })
})
