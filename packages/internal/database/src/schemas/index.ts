import type { FeedViewType } from "@follow/constants"
import type { SupportedActionLanguage } from "@follow/shared/language"
import type { GeneralSettings } from "@follow/shared/settings/interface"
import type { EntrySettings } from "@follow-app/client-sdk"
import { sql } from "drizzle-orm"
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

import type { AttachmentsModel, ExtraModel, ImageColorsResult, MediaModel } from "./types"

export const feedsTable = sqliteTable("feeds", {
  id: text("id").primaryKey(),
  title: text("title"),
  url: text("url").notNull(),
  description: text("description"),
  image: text("image"),
  errorAt: text("error_at"),
  siteUrl: text("site_url"),
  errorMessage: text("error_message"),
  updatedAt: integer("published_at", { mode: "timestamp_ms" }),
})

export const subscriptionsTable = sqliteTable("subscriptions", {
  feedId: text("feed_id"),
  inboxId: text("inbox_id"),
  userId: text("user_id").notNull(),
  view: integer("view").notNull().$type<FeedViewType>(),
  hideFromTimeline: integer("hide_from_timeline", { mode: "boolean" }),
  title: text("title"),
  category: text("category"),
  createdAt: text("created_at"),
  type: text("type").notNull().$type<"feed" | "inbox">(),
  id: text("id").primaryKey(),
})

export const inboxesTable = sqliteTable("inboxes", {
  id: text("id").primaryKey(),
  title: text("title"),
  secret: text("secret").notNull(),
})

export const unreadTable = sqliteTable("unread", {
  id: text("subscription_id").notNull().primaryKey(),
  count: integer("count").notNull(),
})

export const usersTable = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  name: text("name"),
  image: text("image"),
  isMe: integer("is_me", { mode: "boolean" }),
  emailVerified: integer("email_verified", { mode: "boolean" }),
})
export const entriesTable = sqliteTable("entries", {
  id: text("id").primaryKey(),
  title: text("title"),
  url: text("url"),
  content: text("content"),
  readabilityContent: text("source_content"),
  readabilityUpdatedAt: integer("readability_updated_at", { mode: "timestamp_ms" }),
  description: text("description"),
  guid: text("guid").notNull(),
  author: text("author"),
  authorUrl: text("author_url"),
  authorAvatar: text("author_avatar"),
  insertedAt: integer("inserted_at", { mode: "timestamp_ms" }).notNull(),
  publishedAt: integer("published_at", { mode: "timestamp_ms" }).notNull(),
  media: text("media", { mode: "json" }).$type<MediaModel[]>(),
  categories: text("categories", { mode: "json" }).$type<string[]>(),
  attachments: text("attachments", { mode: "json" }).$type<AttachmentsModel[]>(),
  extra: text("extra", { mode: "json" }).$type<ExtraModel>(),
  language: text("language"),

  feedId: text("feed_id"),

  inboxHandle: text("inbox_handle"),
  read: integer("read", { mode: "boolean" }),
  settings: text("settings", { mode: "json" }).$type<EntrySettings>(),
})

export const collectionsTable = sqliteTable("collections", {
  feedId: text("feed_id"),
  entryId: text("entry_id").notNull().primaryKey(),
  createdAt: text("created_at"),
  view: integer("view").notNull().$type<FeedViewType>(),
})

export const summariesTable = sqliteTable(
  "summaries",
  {
    entryId: text("entry_id").notNull(),
    summary: text("summary").notNull(),
    readabilitySummary: text("readability_summary"),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
    language: text("language").$type<SupportedActionLanguage>().notNull(),
  },
  (t) => [uniqueIndex("unq").on(t.entryId, t.language)],
)

export const translationsTable = sqliteTable(
  "translations",
  (t) => ({
    entryId: t.text("entry_id").notNull(),
    language: t.text("language").$type<SupportedActionLanguage>().notNull(),
    mode: t.text("mode").$type<GeneralSettings["translationMode"]>().notNull(),
    title: t.text("title"),
    description: t.text("description"),
    content: t.text("content"),
    readabilityContent: t.text("readability_content"),
    createdAt: t
      .text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  }),
  (t) => [uniqueIndex("translation-unique-index").on(t.entryId, t.language, t.mode)],
)

export const imagesTable = sqliteTable("images", (t) => ({
  url: t.text("url").notNull().primaryKey(),
  colors: t.text("colors", { mode: "json" }).$type<ImageColorsResult>().notNull(),
  createdAt: t
    .integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
}))

// AI Chat Sessions Table
export const aiChatTable = sqliteTable(
  "ai_chat_sessions",
  (t) => ({
    chatId: t.text("id").notNull().primaryKey(),
    title: t.text("title"),
    createdAt: t
      .integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: t
      .integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  }),
  (table) => [index("idx_ai_chat_sessions_updated_at").on(table.updatedAt)],
)

// AI Chat Messages Table - Rich text support
export const aiChatMessagesTable = sqliteTable(
  "ai_chat_messages",
  (t) => ({
    id: t.text("id").notNull().primaryKey(),
    chatId: t
      .text("chat_id")
      .notNull()
      .references(() => aiChatTable.chatId, { onDelete: "cascade" }),

    role: t.text("role").notNull().$type<"user" | "assistant" | "system">(),

    createdAt: t
      .integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    metadata: t.text("metadata", { mode: "json" }).$type<any>(),

    status: t
      .text("status")
      .$type<"pending" | "streaming" | "completed" | "error">()
      .default("completed"),
    finishedAt: t.integer("finished_at", { mode: "timestamp_ms" }),

    // Store UIMessage parts for complex assistant responses (tools, reasoning, etc)
    messageParts: t.text("message_parts", { mode: "json" }).$type<unknown[]>(),
  }),
  (table) => [
    index("idx_ai_chat_messages_chat_id_created_at").on(table.chatId, table.createdAt),
    index("idx_ai_chat_messages_status").on(table.status),
    index("idx_ai_chat_messages_chat_id_role").on(table.chatId, table.role),
  ],
)

export type AiChatMessagesModel = typeof aiChatMessagesTable.$inferSelect

/**
 * Local outbox for user mutations that have not been acknowledged by the server yet.
 * Mirrors the `_transaction` table of Linear's sync engine: a transaction is written here
 * when it is created, replayed on startup, and removed once the server confirms it.
 */
export const syncTransactionsTable = sqliteTable(
  "sync_transactions",
  (t) => ({
    id: t.text("id").notNull().primaryKey(),
    kind: t.text("kind").notNull(),
    payload: t.text("payload", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: t.integer("created_at", { mode: "timestamp_ms" }).notNull(),
    /** The account that made the change. Only that account's session may send it. */
    userId: t.text("user_id"),
  }),
  (table) => [index("idx_sync_transactions_created_at").on(table.createdAt)],
)

/**
 * Small key/value store for sync bookkeeping, such as the last applied sync id.
 */
export const syncMetaTable = sqliteTable("sync_meta", (t) => ({
  key: t.text("key").notNull().primaryKey(),
  value: t.text("value").notNull(),
}))
