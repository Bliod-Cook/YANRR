import type { ChatInit, ChatStatus } from "ai"
import { AbstractChat } from "ai"

import type { BizUIMessage } from "../types"
import type { ChatStateStore } from "./chat-state"
import { ZustandChatState } from "./chat-state"

// Custom Chat class that uses Zustand-integrated state
export class ZustandChat extends AbstractChat<BizUIMessage> {
  override state: ZustandChatState

  constructor({ messages = [], ...init }: ChatInit<BizUIMessage>, store: ChatStateStore) {
    const state = new ZustandChatState(messages, store, init.id || "")
    super({ ...init, state })
    this.state = state

    const baseResumeStream = this.resumeStream.bind(this)
    // Track resume calls so the state can ignore the temporary "submitted" status when no stream exists.
    this.resumeStream = async (...args) => {
      this.state.setResumingStream(true)
      try {
        return await baseResumeStream(...args)
      } finally {
        this.state.setResumingStream(false)
      }
    }
  }

  // Public getter for state access
  get chatState() {
    return this.state
  }

  // Cleanup method
  async destroy(): Promise<void> {
    await this.stop()
    this.state.destroy()
  }

  protected override setStatus({ status, error }: { status: ChatStatus; error?: Error }): void {
    super.setStatus({ status, error })
    this.state.status = status
    this.state.error = error
  }
}
