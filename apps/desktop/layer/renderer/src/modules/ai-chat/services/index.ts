import { db } from "@follow/database/db"
import type { AiChatMessagesModel } from "@follow/database/schemas/index"
import { aiChatMessagesTable, aiChatTable } from "@follow/database/schemas/index"
import { asc, eq, sql } from "drizzle-orm"

import { getI18n } from "~/i18n"

import type { BizUIMessage, BizUIMessagePart, BizUIMetadata } from "../store/types"
import type { ChatSession } from "../types/ChatSession"
import { isDataBlockPart, isFileAttachmentBlock } from "../utils/extractor"

class AIPersistServiceStatic {
  // Cache for session existence to avoid repeated queries
  private sessionExistsCache = new Map<string, boolean>()

  // Clear cache when session is created or deleted
  private markSessionExists(chatId: string, exists: boolean) {
    this.sessionExistsCache.set(chatId, exists)
  }

  private getSessionExistsFromCache(chatId: string): boolean | undefined {
    return this.sessionExistsCache.get(chatId)
  }

  private clearSessionCache(chatId: string) {
    this.sessionExistsCache.delete(chatId)
  }

  async loadMessages(chatId: string): Promise<AiChatMessagesModel[]> {
    return db.query.aiChatMessagesTable.findMany({
      where: eq(aiChatMessagesTable.chatId, chatId),
      orderBy: [asc(aiChatMessagesTable.createdAt)],
    })
  }

  /**
   * Convert enhanced database message to BizUIMessage format for compatibility
   */
  private convertToUIMessage(dbMessage: AiChatMessagesModel): BizUIMessage {
    const uiMessage: BizUIMessage = {
      id: dbMessage.id,
      role: dbMessage.role,
      createdAt: dbMessage.createdAt,
      parts: [],
      metadata: (dbMessage.metadata ?? undefined) as BizUIMetadata | undefined,
    }

    if (dbMessage.messageParts && dbMessage.messageParts.length > 0) {
      uiMessage.parts = dbMessage.messageParts as any[] as BizUIMessagePart[]
    }

    return uiMessage
  }

  /**
   * Enhanced message loading that converts to UIMessage format
   */
  async loadUIMessages(chatId: string): Promise<BizUIMessage[]> {
    const dbMessages = await this.loadMessages(chatId)
    return dbMessages.map((msg) => this.convertToUIMessage(msg))
  }

  /**
   * Load session and messages in a single optimized call
   * Returns both session details and messages to avoid redundant queries
   */
  async loadSessionWithMessages(chatId: string): Promise<{
    session: ChatSession | null
    messages: BizUIMessage[]
  }> {
    // Load both session and messages in parallel
    const [sessionRaw, messages] = await Promise.all([
      this.getChatSession(chatId),
      this.loadUIMessages(chatId),
    ])

    // Convert null title to undefined for type compatibility
    if (!sessionRaw) {
      return { session: null, messages }
    }

    const resolvedTitle = this.resolveSessionTitle(sessionRaw.title, {
      createdAt: sessionRaw.createdAt,
      updatedAt: sessionRaw.updatedAt,
    })

    if (sessionRaw.title !== resolvedTitle) {
      await this.updateSessionTitle(sessionRaw.chatId, resolvedTitle)
    }

    return { session: { ...sessionRaw, title: resolvedTitle }, messages }
  }

  async replaceAllMessages(chatId: string, messages: BizUIMessage[]) {
    await db.delete(aiChatMessagesTable).where(eq(aiChatMessagesTable.chatId, chatId))
    await this.upsertMessages(chatId, messages)
  }

  /**
   * Upsert specific messages (insert new, update existing)
   * Ensures the chat session exists before inserting messages
   */
  async upsertMessages(chatId: string, messages: BizUIMessage[]) {
    if (messages.length === 0) {
      return
    }

    // Ensure the chat session exists first to avoid foreign key constraint failure
    await this.ensureSession(chatId)

    const results = messages.reduce<(typeof aiChatMessagesTable.$inferInsert)[]>((acc, message) => {
      if (message.parts.length === 0) return acc

      const { createdAt } = message
      const cleanParts = [] as typeof message.parts

      for (const part of message.parts) {
        // Skip streaming messages
        if ("state" in part && part.state === "streaming") {
          return acc
        }
        if (isDataBlockPart(part)) {
          const nextPart = structuredClone(part)
          for (const block of nextPart.data) {
            if (isFileAttachmentBlock(block)) {
              Reflect.deleteProperty(block.attachment, "dataUrl")
            }
          }

          cleanParts.push(nextPart)
        } else {
          cleanParts.push(part)
        }
      }

      acc.push({
        id: message.id,
        chatId,
        role: message.role,
        createdAt,
        status: "completed" as const,
        finishedAt: message.metadata?.finishTime
          ? new Date(message.metadata.finishTime)
          : undefined,
        messageParts: cleanParts,
        metadata: message.metadata,
      })

      return acc
    }, [])
    if (results.length === 0) {
      return
    }
    await db
      .insert(aiChatMessagesTable)
      .values(results)
      .onConflictDoUpdate({
        target: [aiChatMessagesTable.id],
        set: {
          messageParts: sql`excluded.message_parts`,
          metadata: sql`excluded.metadata`,
          finishedAt: sql`excluded.finished_at`,
          status: sql`excluded.status`,
          createdAt: sql`excluded.created_at`,
        },
      })

    const date = results.reduce<Date | null>((latest, msg) => {
      const date = msg.createdAt ? new Date(msg.createdAt) : null
      if (date === null) {
        return latest
      }
      if (!latest || date > latest) {
        return date
      }
      return latest
    }, null)
    if (date) {
      // Update session time after successfully saving messages
      await AIPersistService.updateSessionTime(chatId, date)
    }
  }

  private resolveSessionTitle(
    title?: string | null,
    timestamps?: { createdAt?: Date; updatedAt?: Date },
  ): string {
    const trimmed = title?.trim()
    if (trimmed) {
      return trimmed
    }

    return this.getDefaultSessionTitle(timestamps)
  }

  private getDefaultSessionTitle(timestamps?: { createdAt?: Date; updatedAt?: Date }): string {
    const i18n = getI18n()
    const referenceDate = timestamps?.updatedAt ?? timestamps?.createdAt ?? new Date()
    const formattedDateTime = this.formatDateTime(referenceDate, i18n.language)

    return i18n.t("chat.default_title.chat", { ns: "ai", time: formattedDateTime })
  }

  private formatDateTime(date: Date, locale?: string): string {
    try {
      const resolvedLocale = locale && locale.length > 0 ? locale : undefined
      const timeFormatter = new Intl.DateTimeFormat(resolvedLocale, {
        hour: "numeric",
      })
      const dateFormatter = new Intl.DateTimeFormat(resolvedLocale, {
        dateStyle: "medium",
      })

      const formattedTime = timeFormatter.format(date)
      const formattedDate = dateFormatter.format(date)

      return `${formattedTime} ${formattedDate}`
    } catch {
      const pad = (value: number) => value.toString().padStart(2, "0")
      const year = date.getFullYear()
      const month = pad(date.getMonth() + 1)
      const day = pad(date.getDate())
      const hours = pad(date.getHours())
      return `${hours} ${year}-${month}-${day}`
    }
  }

  /**
   * Ensure session exists (idempotent operation)
   */
  async ensureSession(
    chatId: string,
    options: { title?: string; createdAt?: Date; updatedAt?: Date } = {},
  ): Promise<void> {
    const cachedExists = this.getSessionExistsFromCache(chatId)
    const shouldCheckDb = cachedExists !== true || options.title !== undefined

    if (!shouldCheckDb) {
      return
    }

    const existing = await this.getChatSession(chatId)

    if (existing) {
      this.markSessionExists(chatId, true)

      const hasExistingTitle = existing.title?.trim().length
      if (!hasExistingTitle) {
        const resolvedTitle = this.resolveSessionTitle(options.title ?? existing.title, {
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt,
        })
        if (resolvedTitle !== existing.title) {
          await this.updateSessionTitle(chatId, resolvedTitle)
        }
      }
      return
    }

    // Create new session
    await this.createSession(chatId, options)
    this.markSessionExists(chatId, true)
  }

  async createSession(
    chatId: string,
    options: { title?: string; createdAt?: Date; updatedAt?: Date } = {},
  ) {
    const now = new Date()
    await db.insert(aiChatTable).values({
      chatId,
      title: this.resolveSessionTitle(options.title, { createdAt: now, updatedAt: now }),
      createdAt: options.createdAt ?? now,
      updatedAt: options.updatedAt ?? now,
    })
    // Mark session as existing in cache
    this.markSessionExists(chatId, true)
  }

  async getChatSession(chatId: string) {
    const result = await db.query.aiChatTable.findFirst({
      where: eq(aiChatTable.chatId, chatId),
      columns: {
        chatId: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return result?.chatId ? result : null
  }

  /** Every stored chat, the most recently updated first */
  async getChatSessions(): Promise<ChatSession[]> {
    const chats = await db.query.aiChatTable.findMany({
      columns: {
        chatId: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: (t, { desc }) => desc(t.updatedAt),
    })

    return Promise.all(
      chats.map(async (chat) => {
        const resolvedTitle = this.resolveSessionTitle(chat.title, {
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt,
        })

        if (chat.title !== resolvedTitle) {
          await this.updateSessionTitle(chat.chatId, resolvedTitle)
        }

        return { ...chat, title: resolvedTitle }
      }),
    )
  }

  async deleteSession(chatId: string) {
    await db.delete(aiChatMessagesTable).where(eq(aiChatMessagesTable.chatId, chatId))
    await db.delete(aiChatTable).where(eq(aiChatTable.chatId, chatId))
    this.clearSessionCache(chatId)
  }

  async updateSessionTitle(chatId: string, title: string) {
    await db
      .update(aiChatTable)
      .set({
        title,
        updatedAt: new Date(Date.now()),
      })
      .where(eq(aiChatTable.chatId, chatId))
  }

  async updateSessionTime(chatId: string, date: Date = new Date()) {
    await db
      .update(aiChatTable)
      .set({
        updatedAt: date,
      })
      .where(eq(aiChatTable.chatId, chatId))
  }
}
export const AIPersistService = new AIPersistServiceStatic()
