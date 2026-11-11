import type { ChatTransport, UIMessageChunk } from "ai"
import { describe, expect, it, vi } from "vitest"

import { AIPersistService } from "../../services"
import type { BizUIMessage } from "../types"
import { ZustandChat } from "./chat-instance"
import type { ChatSlice } from "./types"

vi.mock("@follow/database/db", async () =>
  (await import("@follow/database/test-db")).createTestDB(),
)

/** A chat whose replies are the chunks the test writes */
const createChat = (chatId: string) => {
  let reply!: ReadableStreamDefaultController<UIMessageChunk>
  const transport: ChatTransport<BizUIMessage> = {
    sendMessages: async () =>
      new ReadableStream<UIMessageChunk>({
        start: (controller) => {
          reply = controller
        },
      }),
    reconnectToStream: async () => null,
  }

  let store = { messages: [] as BizUIMessage[] } as ChatSlice
  const chat = new ZustandChat(
    { id: chatId, transport },
    {
      update: (updater) => {
        store = updater(store)
      },
      onIdle: () => {},
    },
  )

  return {
    chat,
    getStore: () => store,
    write: (...chunks: UIMessageChunk[]) => chunks.forEach((chunk) => reply.enqueue(chunk)),
    end: () => reply.close(),
    lastParts: () => chat.messages.at(-1)!.parts,
  }
}

const ask = (chat: ZustandChat) => {
  void chat.sendMessage({ text: "Hi" })
}

describe("ZustandChatState", () => {
  it("ends the streaming part of a stopped reply and saves the reply", async () => {
    const { chat, write, lastParts } = createChat("stopped-chat")
    ask(chat)
    await vi.waitFor(() => expect(chat.status).toBe("submitted"))

    write(
      { type: "start", messageId: "reply-1" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Half an" },
    )
    await vi.waitFor(() => expect(lastParts().at(-1)).toMatchObject({ text: "Half an" }))
    await chat.stop()
    await vi.waitFor(() => expect(chat.status).toBe("ready"))

    expect(lastParts().at(-1)).toMatchObject({ text: "Half an", state: "done" })
    await vi.waitFor(async () =>
      expect(
        (await AIPersistService.loadUIMessages("stopped-chat")).map((message) => message.id),
      ).toContain("reply-1"),
    )
  })

  it("keeps the parts a reply has finished while it streams on", async () => {
    const { chat, write, lastParts } = createChat("streaming-chat")
    ask(chat)
    await vi.waitFor(() => expect(chat.status).toBe("submitted"))

    write(
      { type: "start", messageId: "reply-2" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "First" },
      { type: "text-end", id: "t1" },
      { type: "text-start", id: "t2" },
      { type: "text-delta", id: "t2", delta: "Sec" },
    )
    await vi.waitFor(() => expect(lastParts().at(-1)).toMatchObject({ text: "Sec" }))
    const [finished, streaming] = lastParts().filter((part) => part.type === "text")

    write({ type: "text-delta", id: "t2", delta: "ond" })
    await vi.waitFor(() => expect(lastParts().at(-1)).toMatchObject({ text: "Second" }))

    const [finishedLater, streamingLater] = lastParts().filter((part) => part.type === "text")
    expect(finishedLater).toBe(finished)
    expect(streamingLater).not.toBe(streaming)
    await chat.stop()
  })

  it("hands the store the whole reply when it ends", async () => {
    const { chat, write, end, getStore } = createChat("synced-chat")
    ask(chat)
    await vi.waitFor(() => expect(chat.status).toBe("submitted"))

    write(
      { type: "start", messageId: "reply-3" },
      { type: "text-start", id: "t1" },
      ...["One", " two", " three"].map((delta) => ({
        type: "text-delta" as const,
        id: "t1",
        delta,
      })),
      { type: "text-end", id: "t1" },
      { type: "finish" },
    )
    end()

    await vi.waitFor(() => expect(getStore().status).toBe("ready"))
    expect(getStore().messages).toBe(chat.messages)
    expect(getStore().messages.at(-1)!.parts.at(-1)).toMatchObject({ text: "One two three" })
  })
})
