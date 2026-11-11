import { beforeEach, describe, expect, it, vi } from "vitest"

import type { BizUIMessage } from "../types"
import { ChatSliceActions } from "./chat-actions"
import type { ChatSlice } from "./types"

const { ensureSessionMock, getChatSessionMock } = vi.hoisted(() => ({
  ensureSessionMock: vi.fn(async () => {}),
  getChatSessionMock: vi.fn(),
}))

vi.mock("../../services", () => ({
  AIPersistService: {
    ensureSession: ensureSessionMock,
    getChatSession: getChatSessionMock,
    saveMessages: vi.fn(async () => {}),
  },
}))

type TestState = Pick<ChatSlice, "chatId" | "currentTitle">

const message: BizUIMessage = {
  id: "m1",
  role: "user",
  parts: [{ type: "text", text: "Hi" }],
  createdAt: new Date(),
}

const createActions = (state: TestState, messages: BizUIMessage[] = [message]) => {
  const set = (updater: (state: TestState) => TestState) => {
    Object.assign(state, updater(state))
  }
  const get = () => state
  const actions = new ChatSliceActions([set, get, {}] as never, state.chatId)
  actions.setMessages(messages)
  return actions
}

describe("ChatSliceActions.adoptStoredTitle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getChatSessionMock.mockResolvedValue({ chatId: "chat-1", title: "9 PM Oct 12, 2026 chat" })
  })

  it("names an untitled chat after its stored session, as the chat history does", async () => {
    const state: TestState = { chatId: "chat-1", currentTitle: undefined }
    await createActions(state).adoptStoredTitle("chat-1")

    expect(ensureSessionMock).toHaveBeenCalledWith("chat-1")
    expect(state.currentTitle).toBe("9 PM Oct 12, 2026 chat")
  })

  it("keeps a title the chat already has", async () => {
    const state: TestState = { chatId: "chat-1", currentTitle: "Generated title" }
    await createActions(state).adoptStoredTitle("chat-1")

    expect(state.currentTitle).toBe("Generated title")
    expect(getChatSessionMock).not.toHaveBeenCalled()
  })

  it("leaves an empty chat and a chat that is no longer shown alone", async () => {
    const empty: TestState = { chatId: "chat-1", currentTitle: undefined }
    await createActions(empty, []).adoptStoredTitle("chat-1")
    expect(empty.currentTitle).toBeUndefined()

    const switched: TestState = { chatId: "chat-1", currentTitle: undefined }
    const actions = createActions(switched)
    getChatSessionMock.mockImplementation(async () => {
      switched.chatId = "chat-2"
      return { chatId: "chat-1", title: "Old chat" }
    })
    await actions.adoptStoredTitle("chat-1")
    expect(switched.currentTitle).toBeUndefined()
  })
})
